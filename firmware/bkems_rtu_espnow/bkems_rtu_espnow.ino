/*
  BKEMS - Rooftop Unit (RTU) node firmware, ESP-NOW
  ------------------------------------------------------------------
  One sketch for every rooftop controller. Change NODE_ID before
  flashing each unit (RTU 1..5). Set NODE_ID = NODE_BRIDGE to flash
  the bridge/central node that will later talk MQTT to the Pi brain.

  Board : ESP32-32D on SunFounder ESP32 Camera Extension (camera unplugged)
  Libs  : ESP32 Arduino core 2.x or 3.x, "LiquidCrystal I2C" (Frank de Brabander)

  Wiring (bench build, Oct 18 2026)
    LCD QAPASS 1602 + PCF8574 backpack : VCC 5V, GND, SDA IO21, SCL IO22, addr 0x27
    Relay board (Inland 4ch, active-LOW, VCC 5V):
      IN1  W  heat    IO25  (purple)
      IN2  Y1 cool 1  IO26  (orange)
      IN3  Y2 cool 2  IO27  (blue)
      IN4  G  fan     IO14  (white)  -- IO14 blips at boot; fan may click once
    Relay contacts: R -> COM, call wire -> NO

  Safety rules baked in
    - Every relay input is floated (OFF) before anything else at boot.
    - Y2 can never be on unless Y1 is on. Y2 sheds first, restores last.
    - Shed commands from the bridge expire (SHED_TIMEOUT_MS). If the
      bridge goes quiet, sheds are released so the unit runs normally.
    - Manual call overrides (CMD_SET_CALL, from the Pi/website) obey the
      same staging rules, the same 30-min cap, and are dropped if the
      bridge goes quiet for 60 s.

  FW 1.1 (Oct 19 2026): CMD_SET_CALL / CMD_CLEAR_CALL, bridge prints
  wanted/call, TX and ACK lines; RTU sends status right after a command.
  FW 1.2 (Oct 19 2026): break-before-make relay output + 200 ms heat/cool
  changeover dead-time, final W vs Y1/Y2 interlock at the pin stage.
  FW 1.3 (Oct 19 2026): DHT11 room temp on IO4, read every 5 s into the
  existing roomTempC10 status field (INT16_MIN = no reading). No packet change.
*/
#define FW_VERSION "1.3"


#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>

// ======================= NODE ID SCHEME ===========================
// One byte. High nibble = node class, low nibble = instance.
//   0x00        broadcast
//   0x01        bridge / central (relays to Pi brain over MQTT later)
//   0x11..0x15  rooftop units 1..5    (class 0x1_)
//   0x21..      back door card reader (class 0x2_, future)
//   0x31..      walk-in cooler probe  (class 0x3_, future)
//   0x41..      walk-in freezer probe (class 0x4_, future)
//   0x51..      room plates           (class 0x5_, future)
#define NODE_BROADCAST   0x00
#define NODE_BRIDGE      0x01
#define NODE_RTU(n)      (0x10 + (n))

// >>>>>>>>>>>>>>>> SET THIS PER BOARD BEFORE FLASHING <<<<<<<<<<<<<<<<
#define NODE_ID          NODE_RTU(1)      // NODE_RTU(1..5) or NODE_BRIDGE
// >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>><<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

#define IS_BRIDGE        (NODE_ID == NODE_BRIDGE)
#define IS_RTU           ((NODE_ID & 0xF0) == 0x10)

// All nodes must share one Wi-Fi channel. When the bridge later joins
// store Wi-Fi, set this to the router's channel (or lock the router).
#define ESPNOW_CHANNEL   1

// ======================= PINS =====================================
#define PIN_SDA   21
#define PIN_SCL   22
#define PIN_W     25
#define PIN_Y1    26
#define PIN_Y2    27
#define PIN_G     14
#define RELAY_ON  LOW      // Inland board is active-low
#define RELAY_OFF HIGH
#define RELAY_DEADTIME_MS 200   // W <-> Y1/Y2 changeover gap

#define PIN_DHT   4
#define TEMP_PERIOD_MS 5000
DHT dht(PIN_DHT, DHT11);

#define LCD_ADDR  0x27     // try 0x3F if the screen stays blank
LiquidCrystal_I2C lcd(LCD_ADDR, 16, 2);

// ======================= MESSAGE FORMAT ===========================
// Every packet = 8-byte header + payload (ESP-NOW max 250 bytes).
// Nodes ignore message types they don't know, so new node classes
// (door, cooler, freezer) can be added without breaking rooftops.
#define BK_MAGIC0  'B'
#define BK_MAGIC1  'K'
#define BK_VER     1

enum MsgType : uint8_t {
  MSG_HEARTBEAT   = 0x01,  // any node -> broadcast, "I'm alive"
  MSG_RTU_STATUS  = 0x10,  // RTU -> bridge, relay/call/shed state
  MSG_RTU_COMMAND = 0x11,  // bridge -> RTU, shed/restore
  MSG_ACK         = 0x12,  // RTU -> bridge, command received
  MSG_TEMP_REPORT = 0x30,  // future: cooler/freezer/room probes
  MSG_DOOR_EVENT  = 0x20,  // future: back door card reader
};

typedef struct __attribute__((packed)) {
  uint8_t  magic[2];   // 'B','K'
  uint8_t  ver;        // BK_VER
  uint8_t  type;       // MsgType
  uint8_t  src;        // sender node ID
  uint8_t  dst;        // target node ID, 0x00 = everyone
  uint16_t seq;        // sender's rolling sequence number
} BkHeader;

// Call/relay bits
#define BIT_W   0x01
#define BIT_Y1  0x02
#define BIT_Y2  0x04
#define BIT_G   0x08

typedef struct __attribute__((packed)) {
  BkHeader h;
  uint8_t  relays;       // which relays are energized (BIT_*)
  uint8_t  wanted;       // what local logic wants before sheds
  uint8_t  shed;         // what's being shed right now
  int16_t  roomTempC10;  // room temp x10 (from room plate later), INT16_MIN = none
  uint32_t uptimeS;
  int8_t   rssi;         // last RSSI seen from the bridge
} RtuStatusMsg;

// Commands
#define CMD_SET_SHED   1   // arg = shed mask (BIT_*), duration = seconds
#define CMD_CLEAR_SHED 2
#define CMD_IDENTIFY   3   // blink backlight so a tech can find the box
#define CMD_SET_CALL   4   // manual override: arg = call mask (BIT_*), duration = seconds
#define CMD_CLEAR_CALL 5   // drop manual override, back to local logic

typedef struct __attribute__((packed)) {
  BkHeader h;
  uint8_t  cmd;
  uint8_t  arg;
  uint16_t durationS;   // 0 = until cleared (still capped by SHED_TIMEOUT_MS)
} RtuCommandMsg;

typedef struct __attribute__((packed)) {
  BkHeader h;
  uint16_t ackSeq;      // seq of the command being acknowledged
  uint8_t  result;      // 0 = ok
} AckMsg;

typedef struct __attribute__((packed)) {
  BkHeader h;
  uint8_t  role;        // high nibble of node ID, for convenience
  uint32_t uptimeS;
} HeartbeatMsg;

// Forward declarations (Arduino auto-prototypes can land above the structs)
void bridgeForwardToPi(const RtuStatusMsg &s);
void sendCommand(uint8_t rtuNum, uint8_t cmd, uint8_t arg, uint16_t durationS);
String callsToText(uint8_t m);
void updateWantedCalls();

// ======================= STATE ====================================
static const uint8_t BCAST_MAC[6] = {0xFF,0xFF,0xFF,0xFF,0xFF,0xFF};
static uint16_t txSeq = 0;

uint8_t  wantedCalls = 0;      // from local logic (room plate temp later)
uint8_t  shedMask    = 0;      // from bridge
uint8_t  relayState  = 0;      // what is actually energized
uint32_t shedUntilMs = 0;
uint8_t  callMask    = 0;      // manual override from bridge (CMD_SET_CALL)
bool     callActive  = false;
uint32_t callUntilMs = 0;
bool     statusNow   = false;  // send a status packet ASAP (after a command)
uint32_t lastBridgeMs = 0;
int8_t   lastRssi    = 0;
int16_t  roomTempC10 = INT16_MIN;

#define STATUS_PERIOD_MS     5000
#define HEARTBEAT_PERIOD_MS 10000
#define SHED_TIMEOUT_MS   (30UL*60UL*1000UL)  // hard cap on any shed: 30 min
#define BRIDGE_LOST_MS    (60UL*1000UL)       // release sheds if bridge silent 60 s

// Bridge-side table of what each RTU last reported
struct RtuSeen { bool seen; uint32_t atMs; RtuStatusMsg last; };
RtuSeen rtuTable[6];   // index 1..5

// ======================= HELPERS ==================================
void fillHeader(BkHeader &h, uint8_t type, uint8_t dst) {
  h.magic[0] = BK_MAGIC0; h.magic[1] = BK_MAGIC1;
  h.ver = BK_VER; h.type = type; h.src = NODE_ID; h.dst = dst;
  h.seq = txSeq++;
}

void sendRaw(const void *data, size_t len) {
  // Broadcast keeps setup simple (no MAC pairing). Receivers filter by dst.
  esp_now_send(BCAST_MAC, (const uint8_t *)data, len);
}

// Inland board VCC is 5V, so an ESP32 3.3V HIGH doesn't fully turn the input
// LED off. Drive LOW for ON, and float the pin (high-Z) for OFF.
void writeRelay(uint8_t pin, bool on) {
  if (on) { digitalWrite(pin, LOW); pinMode(pin, OUTPUT); }
  else    { pinMode(pin, INPUT); }
}

void allRelaysOff() {
  writeRelay(PIN_W, false); writeRelay(PIN_Y1, false);
  writeRelay(PIN_Y2, false); writeRelay(PIN_G, false);
  relayState = 0;
}

// Apply wanted calls minus sheds, enforcing staging rules.
void applyRelays() {
  uint8_t out = wantedCalls & ~shedMask;
  if (!(out & BIT_Y1)) out &= ~BIT_Y2;        // Y2 never without Y1
  if ((out & BIT_W) && (out & (BIT_Y1|BIT_Y2))) // never heat and cool together
    out &= ~(BIT_Y1|BIT_Y2);

  // Final interlock check right before the pins (belt and braces).
  if ((out & BIT_W) && (out & (BIT_Y1|BIT_Y2))) out = 0;

  // Break before make: de-energize everything that must be off first
  // (Y2 before Y1), so W and Y1/Y2 are never driven at the same instant.
  if (!(out & BIT_Y2)) writeRelay(PIN_Y2, false);
  if (!(out & BIT_Y1)) writeRelay(PIN_Y1, false);
  if (!(out & BIT_W))  writeRelay(PIN_W,  false);
  if (!(out & BIT_G))  writeRelay(PIN_G,  false);

  // Heat <-> cool changeover: give the released contacts time to open.
  bool wasHeat = relayState & BIT_W, wasCool = relayState & (BIT_Y1|BIT_Y2);
  if ((wasHeat && (out & (BIT_Y1|BIT_Y2))) || (wasCool && (out & BIT_W))) delay(RELAY_DEADTIME_MS);

  // Make: raise Y1 before Y2.
  if (out & BIT_W)  writeRelay(PIN_W,  true);
  if (out & BIT_Y1) writeRelay(PIN_Y1, true);
  if ((out & BIT_Y2) && !(relayState & BIT_Y2)) delay(50);
  if (out & BIT_Y2) writeRelay(PIN_Y2, true);
  if (out & BIT_G)  writeRelay(PIN_G,  true);
  relayState = out;
}

String callsToText(uint8_t m) {
  String s;
  s += (m & BIT_W)  ? "W "  : "- ";
  s += (m & BIT_Y1) ? "Y1 " : "-- ";
  s += (m & BIT_Y2) ? "Y2 " : "-- ";
  s += (m & BIT_G)  ? "G"   : "-";
  return s;
}

// ======================= RECEIVE ==================================
void handlePacket(const uint8_t *data, int len, int8_t rssi) {
  if (len < (int)sizeof(BkHeader)) return;
  const BkHeader *h = (const BkHeader *)data;
  if (h->magic[0] != BK_MAGIC0 || h->magic[1] != BK_MAGIC1) return;
  if (h->ver != BK_VER) return;                     // future: handle older versions
  if (h->src == NODE_ID) return;
  if (h->dst != NODE_BROADCAST && h->dst != NODE_ID) return;

  if (h->src == NODE_BRIDGE) { lastBridgeMs = millis(); lastRssi = rssi; }

  switch (h->type) {
    case MSG_RTU_COMMAND: {
      if (!IS_RTU || len < (int)sizeof(RtuCommandMsg)) return;
      const RtuCommandMsg *c = (const RtuCommandMsg *)data;
      uint8_t result = 0;
      if (c->cmd == CMD_SET_SHED) {
        shedMask = c->arg & (BIT_W|BIT_Y1|BIT_Y2|BIT_G);
        if (shedMask & BIT_Y1) shedMask |= BIT_Y2;   // shedding Y1 implies Y2
        uint32_t dur = c->durationS ? (uint32_t)c->durationS * 1000UL : SHED_TIMEOUT_MS;
        if (dur > SHED_TIMEOUT_MS) dur = SHED_TIMEOUT_MS;
        shedUntilMs = millis() + dur;
      } else if (c->cmd == CMD_CLEAR_SHED) {
        shedMask = 0;
      } else if (c->cmd == CMD_SET_CALL) {
        callMask = c->arg & (BIT_W|BIT_Y1|BIT_Y2|BIT_G);
        uint32_t dur = c->durationS ? (uint32_t)c->durationS * 1000UL : SHED_TIMEOUT_MS;
        if (dur > SHED_TIMEOUT_MS) dur = SHED_TIMEOUT_MS;
        callUntilMs = millis() + dur;
        callActive = true;
        updateWantedCalls();
      } else if (c->cmd == CMD_CLEAR_CALL) {
        callActive = false; callMask = 0;
        updateWantedCalls();
      } else if (c->cmd == CMD_IDENTIFY) {
        for (int i = 0; i < 6; i++) { lcd.noBacklight(); delay(150); lcd.backlight(); delay(150); }
      } else {
        result = 1;  // unknown command
      }
      applyRelays();
      AckMsg a; fillHeader(a.h, MSG_ACK, h->src); a.ackSeq = h->seq; a.result = result;
      sendRaw(&a, sizeof(a));
      statusNow = true;
      break;
    }
    case MSG_RTU_STATUS: {
      if (!IS_BRIDGE || len < (int)sizeof(RtuStatusMsg)) return;
      uint8_t n = h->src & 0x0F;
      if (n >= 1 && n <= 5) {
        rtuTable[n].seen = true; rtuTable[n].atMs = millis();
        memcpy(&rtuTable[n].last, data, sizeof(RtuStatusMsg));
        bridgeForwardToPi(rtuTable[n].last);
      }
      break;
    }
    case MSG_ACK: {
      if (IS_BRIDGE && len >= (int)sizeof(AckMsg)) {
        const AckMsg *a = (const AckMsg *)data;
        Serial.printf("[bridge] ACK RTU%u seq=%u result=%u\n", h->src & 0x0F, a->ackSeq, a->result);
      }
      break;
    }
    case MSG_HEARTBEAT:
      break;                                // bridge can log these later
    default:
      break;                                // unknown type: ignore, don't break
  }
}

// ======================= BRIDGE HOOK ==============================
// MQTT to the Pi brain goes here later. Suggested topic layout:
//   bkems/<store>/rtu/<n>/status   (JSON of RtuStatusMsg)
//   bkems/<store>/rtu/<n>/cmd      (Pi -> bridge -> sendCommand())
void bridgeForwardToPi(const RtuStatusMsg &s) {
  Serial.printf("[bridge] RTU%u relays=%s wanted=0x%02X shed=0x%02X up=%lus rssi=%d\n",
    s.h.src & 0x0F, callsToText(s.relays).c_str(), s.wanted, s.shed,
    (unsigned long)s.uptimeS, s.rssi);
  // TODO: publish over MQTT once the Pi side is decided.
}

// Bridge helper: send a shed/restore to one RTU (1..5) or all (0).
void sendCommand(uint8_t rtuNum, uint8_t cmd, uint8_t arg, uint16_t durationS) {
  RtuCommandMsg c;
  fillHeader(c.h, MSG_RTU_COMMAND, rtuNum ? NODE_RTU(rtuNum) : NODE_BROADCAST);
  c.cmd = cmd; c.arg = arg; c.durationS = durationS;
  sendRaw(&c, sizeof(c));
  Serial.printf("[bridge] TX RTU%u cmd=%u arg=0x%02X dur=%us seq=%u\n",
    rtuNum, cmd, arg, durationS, c.h.seq);
}

// Bridge test console over USB serial, e.g. "shed 2 y2 600", "clear 0", "id 3"
void bridgeSerialConsole() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n'); line.trim(); line.toLowerCase();
  char verb[8] = {0}, what[8] = {0}; int n = 0, secs = 0;
  int got = sscanf(line.c_str(), "%7s %d %7s %d", verb, &n, what, &secs);
  if (got >= 2 && !strcmp(verb, "clear")) sendCommand(n, CMD_CLEAR_SHED, 0, 0);
  else if (got >= 2 && !strcmp(verb, "release")) sendCommand(n, CMD_CLEAR_CALL, 0, 0);
  else if (got >= 2 && !strcmp(verb, "id")) sendCommand(n, CMD_IDENTIFY, 0, 0);
  else if (got >= 3 && !strcmp(verb, "shed")) {
    uint8_t m = 0;
    if (strstr(what, "w"))  m |= BIT_W;
    if (strstr(what, "y1")) m |= BIT_Y1;
    if (strstr(what, "y2")) m |= BIT_Y2;
    if (strstr(what, "g"))  m |= BIT_G;
    sendCommand(n, CMD_SET_SHED, m, (uint16_t)secs);
  } else if (got >= 3 && !strcmp(verb, "call")) {
    uint8_t m = 0;
    if (strstr(what, "w"))  m |= BIT_W;
    if (strstr(what, "y1")) m |= BIT_Y1;
    if (strstr(what, "y2")) m |= BIT_Y2;
    if (strstr(what, "g"))  m |= BIT_G;
    sendCommand(n, CMD_SET_CALL, m, (uint16_t)secs);   // "call 1 none" = override to all-off
  } else if (got >= 1 && !strcmp(verb, "ver")) Serial.printf("BKEMS fw %s node 0x%02X\n", FW_VERSION, NODE_ID);
  else Serial.println("cmds: shed <rtu|0> <w|y1|y2|g> [secs] | clear <rtu|0> | call <rtu|0> <w|y1|y2|g|none> [secs] | release <rtu|0> | id <rtu|0> | ver");
}

// ======================= ESP-NOW CALLBACKS ========================
#if ESP_ARDUINO_VERSION_MAJOR >= 3
void onRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  int8_t rssi = info->rx_ctrl ? info->rx_ctrl->rssi : 0;
  handlePacket(data, len, rssi);
}
#else
void onRecv(const uint8_t *mac, const uint8_t *data, int len) {
  handlePacket(data, len, 0);
}
#endif

// ======================= LOCAL CALL LOGIC (STUB) ==================
// Room plates will send room temp; this node then decides W/Y1/Y2/G.
// Until that's built, nothing is called: all relays stay off.
void updateWantedCalls() {
  wantedCalls = 0;
  if (callActive) { wantedCalls = callMask; return; }   // manual override from Pi/website
  // TODO: thermostat logic from room plate temp + setpoints + schedule.
}

// ======================= LCD ======================================
void drawLcd() {
  lcd.setCursor(0, 0);
  char l1[17];
  if (IS_BRIDGE) snprintf(l1, sizeof(l1), "BRIDGE  ch%-2d    ", ESPNOW_CHANNEL);
  else snprintf(l1, sizeof(l1), "RTU %d %s     ", NODE_ID & 0x0F,
                (millis() - lastBridgeMs < BRIDGE_LOST_MS && lastBridgeMs) ? "LINK" : "NOLINK");
  lcd.print(l1);
  lcd.setCursor(0, 1);
  char l2[17];
  if (IS_BRIDGE) {
    int seen = 0;
    for (int i = 1; i <= 5; i++) if (rtuTable[i].seen && millis() - rtuTable[i].atMs < 30000) seen++;
    snprintf(l2, sizeof(l2), "RTUs online: %d  ", seen);
  } else {
    snprintf(l2, sizeof(l2), "%-12s%s", callsToText(relayState).c_str(), shedMask ? "SHED" : "    ");
  }
  lcd.print(l2);
}

// DHT11 read: ~25 ms worst case, called after relay logic. NaN -> sentinel.
void readTemp() {
  float c = dht.readTemperature();
  if (isnan(c) || c < -20 || c > 70) { roomTempC10 = INT16_MIN; Serial.println("DHT11: read failed"); }
  else { roomTempC10 = (int16_t)lroundf(c * 10.0f);
         Serial.printf("DHT11: %.1fC %.1fF\n", c, c * 1.8f + 32.0f); }
}

// ======================= SETUP / LOOP =============================
void setup() {
  // Relays OFF before anything else.
  allRelaysOff();   // all relay pins floating = relays off

  Serial.begin(115200);
  Wire.begin(PIN_SDA, PIN_SCL);
  lcd.init(); lcd.backlight(); lcd.clear();
  lcd.print("BKEMS starting");
  dht.begin();

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE);
  Serial.printf("BKEMS fw %s  node 0x%02X  MAC %s  ch%d\n", FW_VERSION, NODE_ID, WiFi.macAddress().c_str(), ESPNOW_CHANNEL);

  if (esp_now_init() != ESP_OK) {
    lcd.clear(); lcd.print("ESP-NOW FAIL");
    Serial.println("ESP-NOW init failed; restarting in 5 s");
    delay(5000); ESP.restart();
  }
  esp_now_register_recv_cb(onRecv);

  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BCAST_MAC, 6);
  peer.channel = ESPNOW_CHANNEL;
  peer.encrypt = false;
  esp_now_add_peer(&peer);

  lcd.clear();
}

void loop() {
  static uint32_t lastStatus = 0, lastBeat = 0, lastLcd = 0, lastTemp = 0;
  uint32_t now = millis();

  if (IS_RTU) {
    // Release sheds when they expire or the bridge goes quiet.
    if (shedMask && ((int32_t)(now - shedUntilMs) >= 0 ||
                     (lastBridgeMs && now - lastBridgeMs > BRIDGE_LOST_MS))) {
      shedMask = 0;
    }
    if (callActive && ((int32_t)(now - callUntilMs) >= 0 ||
                       (lastBridgeMs && now - lastBridgeMs > BRIDGE_LOST_MS))) {
      callActive = false; callMask = 0;
    }
    updateWantedCalls();
    applyRelays();

    if (statusNow || now - lastStatus >= STATUS_PERIOD_MS) {
      lastStatus = now; statusNow = false;
      RtuStatusMsg s; fillHeader(s.h, MSG_RTU_STATUS, NODE_BRIDGE);
      s.relays = relayState; s.wanted = wantedCalls; s.shed = shedMask;
      s.roomTempC10 = roomTempC10; s.uptimeS = now / 1000; s.rssi = lastRssi;
      sendRaw(&s, sizeof(s));
    }
    if (now - lastTemp >= TEMP_PERIOD_MS) { lastTemp = now; readTemp(); }
  }

  if (IS_BRIDGE) bridgeSerialConsole();

  if (now - lastBeat >= HEARTBEAT_PERIOD_MS) {
    lastBeat = now;
    HeartbeatMsg b; fillHeader(b.h, MSG_HEARTBEAT, NODE_BROADCAST);
    b.role = NODE_ID & 0xF0; b.uptimeS = now / 1000;
    sendRaw(&b, sizeof(b));
  }

  if (now - lastLcd >= 1000) { lastLcd = now; drawLcd(); }
  delay(20);
}

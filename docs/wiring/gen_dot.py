# Generates BKEMS-Wiring-Diagram.dot with fixed node positions (inches), rendered by neato -n
def P(x, y): return f'pos="{x*72:.0f},{y*72:.0f}"'
dot = r'''digraph BKEMS {
  graph [splines=true, sep="+1", outputorder=edgesfirst, fontname="Barlow Semi Condensed", fontsize=24, labelloc=t, pad=0.15,
         label=<<B>BKEMS Prototype Store - Bench Wiring (draft rev 3, Oct 5 2026)</B><BR/><FONT POINT-SIZE="13">Rev 3: store node + ESP32 at EACH RTU. Buck fed from RTU transformer via ~1A inline fuse. C required (taken at the unit). Pins marked <I>(proposed)</I> are suggestions; relay pins and wire colors are from Andy's notes. MQTT contract v1.0.</FONT>>];
  node [fontname="Barlow Semi Condensed", fontsize=13, shape=box, style="rounded,filled", fillcolor="white", margin="0.12,0.06"];
  edge [fontname="Barlow Semi Condensed", fontsize=12, penwidth=1.8, arrowsize=0.8];

  PWR [shape=plain, POS_PWR, label=<
    <TABLE BORDER="2" CELLBORDER="1" CELLSPACING="0" CELLPADDING="5" BGCOLOR="#fff7e0" COLOR="#c9a227">
      <TR><TD BGCOLOR="#c9a227"><FONT COLOR="white"><B>POWER (store node)</B></FONT></TD></TR>
      <TR><TD PORT="p5" BGCOLOR="white"><B>5V bench supply</B> (USB or breadboard PSU)<BR/>feeds store ESP32 + Inland 4-ch relay</TD></TR>
      <TR><TD PORT="p12" BGCOLOR="white"><B>12V DC supply</B> - <I>only if the 16-ch / 8-ch</I><BR/><I>relay boards are used (not the 4-ch)</I></TD></TR>
    </TABLE>>];

  TEMP [shape=plain, POS_TEMP, label=<
    <TABLE BORDER="2" CELLBORDER="0" CELLSPACING="0" CELLPADDING="3" BGCOLOR="#e8f4ff" COLOR="#3b82c4">
      <TR><TD BGCOLOR="#3b82c4"><FONT COLOR="white"><B>DS18B20 one-wire bus</B> (GPIO4, <I>proposed</I>)</FONT></TD></TR>
      <TR><TD ALIGN="LEFT">1. Walk-in cooler     2. Freezer</TD></TR>
      <TR><TD ALIGN="LEFT">3. Dining room        4. Duct supply air</TD></TR>
      <TR><TD ALIGN="RIGHT" PORT="red"><FONT COLOR="#cc0000"><B>Red lead = 3V3</B></FONT></TD></TR>
      <TR><TD ALIGN="RIGHT" PORT="blk"><B>Black lead = GND</B></TD></TR>
      <TR><TD ALIGN="RIGHT" PORT="yel"><FONT COLOR="#a07800"><B>Yellow lead = data (GPIO4)</B></FONT></TD></TR>
      <TR><TD ALIGN="LEFT"><B>4.7k pull-up resistor: data to 3V3</B></TD></TR>
    </TABLE>>];

  LUX  [POS_LUX, fillcolor="#e8f4ff", color="#3b82c4", label=<<B>Photocell / light sensor</B><BR/>analog out to GPIO34 (<I>proposed</I>)>];
  DOOR [POS_DOOR, fillcolor="#e8f4ff", color="#3b82c4", label=<<B>AD2000-M door panel</B><BR/>status / alarm output<BR/>(panel keeps doing the locking)>];
  OPTD [POS_OPTD, fillcolor="#f3e8ff", color="#7a3fc4", label=<<B>Optocoupler</B><BR/>door signal<BR/>(<I>proposed</I>)>];

  RTUEQ [shape=plain, POS_RTUEQ, label=<
    <TABLE BORDER="2" CELLBORDER="1" CELLSPACING="0" CELLPADDING="5" BGCOLOR="#eef7ee" COLOR="#3f8f3f">
      <TR><TD BGCOLOR="#3f8f3f"><FONT COLOR="white"><B>EACH ROOFTOP UNIT (up to 5)</B></FONT></TD></TR>
      <TR><TD PORT="tstat" BGCOLOR="white"><B>Original thermostat stays PRIMARY</B><BR/>R  W  Y1  G  C  (24VAC)<BR/><I>+ Y2 if the unit has 2-stage cool; W2 if available</I></TD></TR>
      <TR><TD PORT="y1" BGCOLOR="white">Y1 / Y2 cooling-call wires<BR/><I>(each through its own shed relay NC)</I></TD></TR>
      <TR><TD PORT="xfmr" BGCOLOR="white"><B>RTU's own 24VAC transformer</B><BR/>Tap after any existing R-side fuse/breaker.<BR/><FONT COLOR="#cc0000"><B>C required</B></FONT> — taken at the unit (buck return + opto ref).<BR/>Never needed at the thermostat.</TD></TR>
    </TABLE>>];

  FUSE [POS_FUSE, fillcolor="#ffe0e0", color="#cc0000", penwidth=2.5, label=<<B>~1A INLINE FUSE</B><BR/>on our feed from the RTU transformer<BR/>(protects unit control fuse from our short)>];

  BUCK [POS_BUCK, fillcolor="#fff7e0", color="#c9a227", penwidth=2, label=<<B>24VAC to 5VDC buck converter</B><BR/>AT the RTU (pick 5V out, ≥36VAC / ~50VDC in, 1A+)<BR/>fed through the ~1A fuse from transformer R/C>];

  OPT24 [POS_OPT24, fillcolor="#f3e8ff", color="#7a3fc4", label=<<B>24VAC optocouplers (x4)</B><BR/>W, Y1, Y2 (<I>optional</I>), G  +  W2 (<I>optional</I>)<BR/>AC side referenced to unit C; logic side to RTU-node inputs>];

  SHED [shape=plain, POS_SHED, label=<
    <TABLE BORDER="2" CELLBORDER="1" CELLSPACING="0" CELLPADDING="4" BGCOLOR="#e8efff" COLOR="#1e5bd8">
      <TR><TD BGCOLOR="#1e5bd8"><FONT COLOR="white"><B>SHED RELAYS (5V, NC contacts, <I>proposed</I>)</B></FONT></TD></TR>
      <TR><TD PORT="s1" BGCOLOR="white"><B>Stage-1 shed:</B> NC in series with Y1</TD></TR>
      <TR><TD PORT="s2" BGCOLOR="white"><B>Stage-2 shed</B> (<I>optional, 2-stage units</I>): NC in series with Y2</TD></TR>
      <TR><TD ALIGN="LEFT"><B>Staging:</B> Y1 first; Y2 only if Y1 can't carry the load.<BR ALIGN="LEFT"/><B>Y2 is never energized without Y1.</B><BR ALIGN="LEFT"/><B>Shed:</B> Y2 first, then Y1.   <B>Restore:</B> Y1 first, then Y2.<BR ALIGN="LEFT"/>300 s anti-short-cycle applies per stage.<BR ALIGN="LEFT"/></TD></TR>
    </TABLE>>];

  RTUESP [shape=plain, POS_RTUESP, label=<
    <TABLE BORDER="3" CELLBORDER="1" CELLSPACING="0" CELLPADDING="4" BGCOLOR="white" COLOR="#3f8f3f">
      <TR><TD COLSPAN="2" BGCOLOR="#3f8f3f"><FONT COLOR="white" POINT-SIZE="13"><B>ESP32 RTU NODE - one at each RTU</B></FONT><BR/><FONT COLOR="white">x up to 5, all pins <I>proposed</I></FONT></TD></TR>
      <TR><TD PORT="wifi" BGCOLOR="#e6f7f2"><B>Wi-Fi</B></TD><TD PORT="wifie">MQTT client</TD></TR>
      <TR><TD PORT="g4" BGCOLOR="#eef7ee"><B>GPIO4</B></TD><TD PORT="g4e">DS18B20 supply/return (optional)</TD></TR>
      <TR><TD PORT="v5"  BGCOLOR="#eef7ee"><B>5V / VIN</B></TD><TD>from RTU buck</TD></TR>
      <TR><TD PORT="v33" BGCOLOR="#eef7ee"><B>3V3</B></TD><TD>DS18B20 + pull-ups</TD></TR>
      <TR><TD PORT="gnd" BGCOLOR="#eef7ee"><B>GND</B></TD><TD>common GND</TD></TR>
      <TR><TD PORT="g32" BGCOLOR="#eef7ee"><B>GPIO32</B></TD><TD>W heat call (pull-up)</TD></TR>
      <TR><TD PORT="g33" BGCOLOR="#eef7ee"><B>GPIO33</B></TD><TD>Y1 cool stage 1 (pull-up)</TD></TR>
      <TR><TD PORT="g27" BGCOLOR="#eef7ee"><B>GPIO27</B></TD><TD>Y2 cool stage 2 (<I>optional</I>, pull-up)</TD></TR>
      <TR><TD PORT="g25" BGCOLOR="#eef7ee"><B>GPIO25</B></TD><TD>G fan call (pull-up)</TD></TR>
      <TR><TD PORT="g13" BGCOLOR="#eef7ee"><B>GPIO13</B></TD><TD>W2 heat stage 2 (<I>optional</I>)</TD></TR>
      <TR><TD PORT="g26" BGCOLOR="#eef7ee"><B>GPIO26</B></TD><TD>stage-1 shed relay IN (Y1)</TD></TR>
      <TR><TD PORT="g19" BGCOLOR="#eef7ee"><B>GPIO19</B></TD><TD>stage-2 shed relay IN (Y2, <I>optional</I>)</TD></TR>
    </TABLE>>];

  RAIR [POS_RAIR, fillcolor="#e8f4ff", color="#3b82c4", style="rounded,dashed,filled", label=<<B>DS18B20 (optional)</B><BR/>supply / return air<BR/>4.7k pull-up to 3V3>];

  ESP [shape=plain, POS_ESP, label=<
    <TABLE BORDER="3" CELLBORDER="1" CELLSPACING="0" CELLPADDING="4" BGCOLOR="white" COLOR="#bb3333">
      <TR><TD COLSPAN="2" BGCOLOR="#bb3333"><FONT COLOR="white" POINT-SIZE="13"><B>ESP32 DevKit on Freenove breakout</B></FONT><BR/><FONT COLOR="white">STORE NODE - device key store-{id}-gw</FONT></TD></TR>
      <TR><TD PORT="v5"  BGCOLOR="#fdecea"><B>5V / VIN</B></TD><TD>power in from 5V supply</TD></TR>
      <TR><TD PORT="v33" BGCOLOR="#fdecea"><B>3V3</B></TD><TD>sensor power + pull-up</TD></TR>
      <TR><TD PORT="gnd" BGCOLOR="#fdecea"><B>GND</B></TD><TD>sensor ground</TD></TR>
      <TR><TD PORT="g4"  BGCOLOR="#fdecea"><B>GPIO4</B></TD><TD>DS18B20 data (<I>proposed</I>)</TD></TR>
      <TR><TD PORT="g34" BGCOLOR="#fdecea"><B>GPIO34</B></TD><TD>light analog (<I>proposed</I>)</TD></TR>
      <TR><TD PORT="g32" BGCOLOR="#fdecea"><B>GPIO32</B></TD><TD>door status (<I>proposed</I>)</TD></TR>
      <TR><TD>relay IN1</TD><TD PORT="g25" BGCOLOR="#fdecea"><B>GPIO25</B></TD></TR>
      <TR><TD>relay IN2</TD><TD PORT="g26" BGCOLOR="#fdecea"><B>GPIO26</B></TD></TR>
      <TR><TD>relay IN3</TD><TD PORT="g27" BGCOLOR="#fdecea"><B>GPIO27</B></TD></TR>
      <TR><TD>relay IN4</TD><TD PORT="g33" BGCOLOR="#fdecea"><B>GPIO33</B></TD></TR>
      <TR><TD>relay ground</TD><TD PORT="gnd2" BGCOLOR="#fdecea"><B>GND</B></TD></TR>
      <TR><TD>MQTT client</TD><TD PORT="wifi" BGCOLOR="#e6f7f2"><B>Wi-Fi</B></TD></TR>
    </TABLE>>];

  RLY [shape=plain, POS_RLY, label=<
    <TABLE BORDER="3" CELLBORDER="1" CELLSPACING="0" CELLPADDING="4" BGCOLOR="white" COLOR="#555555">
      <TR><TD COLSPAN="2" BGCOLOR="#555555"><FONT COLOR="white" POINT-SIZE="13"><B>Inland 4-ch relay (5V, SRD-05VDC)</B></FONT><BR/><FONT COLOR="white">loads wired on NC contacts = fail-safe</FONT></TD></TR>
      <TR><TD PORT="vcc" BGCOLOR="#eeeeee"><B>VCC</B></TD><TD PORT="vcco" ALIGN="LEFT">5V</TD></TR>
      <TR><TD PORT="in1" BGCOLOR="#eeeeee"><B>IN1</B></TD><TD PORT="o1" ALIGN="LEFT">relay_parking_lot</TD></TR>
      <TR><TD PORT="in2" BGCOLOR="#eeeeee"><B>IN2</B></TD><TD PORT="o2" ALIGN="LEFT">relay_exterior_signs</TD></TR>
      <TR><TD PORT="in3" BGCOLOR="#eeeeee"><B>IN3</B></TD><TD PORT="o3" ALIGN="LEFT">relay_hvac_shed_stage1</TD></TR>
      <TR><TD PORT="in4" BGCOLOR="#eeeeee"><B>IN4</B></TD><TD PORT="o4" ALIGN="LEFT">relay_spare_ch4</TD></TR>
      <TR><TD PORT="gnd" BGCOLOR="#eeeeee"><B>GND</B></TD><TD ALIGN="LEFT">tied to ESP32 GND</TD></TR>
    </TABLE>>];

  LOADS [POS_LOADS, fillcolor="#f2f2f2", label=<<B>Loads on NC contacts</B><BR/>stay ON if ESP32 or server is down<BR/>- Parking lot lights (IN1)<BR/>- Exterior signs (IN2)<BR/>- Spare (IN4)>];
  Y1 [POS_Y1, fillcolor="#e8efff", color="#1e5bd8", label=<<B>IN3 relay_hvac_shed_stage1</B><BR/>(from Andy's notes - kept for now)<BR/>Rev 2+: per-RTU stage-1 shed may move<BR/>to each RTU node's own relay>];

  PI [POS_PI, fillcolor="#e6f7f2", color="#178a6a", penwidth=2.5, label=<<B>Raspberry Pi gateway</B><BR/>Mosquitto broker + edge agent<BR/>raspberrypi.local / 10.0.0.165>];
  CC [POS_CC, fillcolor="#e6f7f2", color="#178a6a", penwidth=2.5, label=<<B>Command Center website</B><BR/>Mac mini now (LAN)<BR/>bkems.info later>];

  ROOM [shape=plain, POS_ROOM, label=<
    <TABLE BORDER="2" CELLBORDER="0" CELLSPACING="0" CELLPADDING="3" BGCOLOR="#eaf0ff" COLOR="#4b5fc4">
      <TR><TD BGCOLOR="#4b5fc4"><FONT COLOR="white"><B>ROOM SENSOR PLATES x4</B> (one per RTU)</FONT></TD></TR>
      <TR><TD><B>ESP32-C3 + DS18B20</B></TD></TR>
      <TR><TD><FONT COLOR="#1d7a1d"><B>Green = fan</B></FONT>   <FONT COLOR="#cc0000"><B>Red = heat</B></FONT>   <FONT COLOR="#1e5bd8"><B>Blue = cool</B></FONT></TD></TR>
      <TR><TD>screw terminals: 5V + GND only</TD></TR>
      <TR><TD><I>5V fed from the buck AT the RTU (keep ≥4.5V at plate)</I></TD></TR>
      <TR><TD><FONT COLOR="#0f5e48"><B>Wi-Fi MQTT to the Pi</B></FONT></TD></TR>
    </TABLE>>];

  SAFE [shape=plain, POS_SAFE, label=<
    <TABLE BORDER="3" CELLBORDER="0" CELLSPACING="0" CELLPADDING="3" BGCOLOR="#fff3b0" COLOR="#cc0000">
      <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="14" COLOR="#cc0000"><B>SAFETY</B></FONT></TD></TR>
      <TR><TD ALIGN="LEFT">- <B>NEVER</B> put 24VAC on an ESP32 pin (use optocouplers)</TD></TR>
      <TR><TD ALIGN="LEFT">- 24VAC only on optocoupler inputs + buck input</TD></TR>
      <TR><TD ALIGN="LEFT">- <B>C required</B>, taken at the unit (never at thermostat)</TD></TR>
      <TR><TD ALIGN="LEFT">- ~1A inline fuse on our transformer feed</TD></TR>
      <TR><TD ALIGN="LEFT">- Common GND: relay GND tied to ESP32 GND</TD></TR>
      <TR><TD ALIGN="LEFT">- Loads on NC contacts = fail-safe</TD></TR>
      <TR><TD ALIGN="LEFT">- Bench only. <B>No compressor control.</B></TD></TR>
      <TR><TD ALIGN="LEFT">- Original thermostat stays primary</TD></TR>
    </TABLE>>];

  // power
  PWR:p5:w  -> ESP:v5:w  [color="#d00000", label="5V"];
  PWR:p5:e  -> RLY:vcc:w [color="#d00000", label="5V"];
  PWR:p12:e -> RLY:vcc:w [color="#d00000", style=dashed, label="12V (big boards only)"];

  // sensors
  TEMP:red:e -> ESP:v33:w [color="#d00000", dir=back];
  TEMP:yel:e -> ESP:g4:w  [color="#c9a000"];
  TEMP:blk:e -> ESP:gnd:w [color="black"];
  LUX:e  -> ESP:g34:w [color="#3b82c4"];
  DOOR:e -> OPTD:w    [color="#7a3fc4"];
  OPTD:e -> ESP:g32:w [color="#7a3fc4"];

  // RTU (rev 3: fuse between transformer and buck; C required at unit)
  RTUEQ:tstat:e -> OPT24:w [color="#3f8f3f", label=<W Y1 Y2 G<BR/>(24VAC vs C)<BR/> >];
  RTUEQ:y1:e -> SHED:w [color="#1e5bd8", dir=both, penwidth=2.2, label=<Y1 / Y2<BR/>in series>];
  RTUEQ:xfmr:s -> FUSE:n [color="#3f8f3f", penwidth=2.4, label=<24VAC R/C    >];
  FUSE:s -> BUCK:n [color="#cc0000", penwidth=2.6, label=<~1A fuse    >];
  OPT24:e -> RTUESP:g32:w [color="#7a3fc4"];
  OPT24:e -> RTUESP:g33:w [color="#7a3fc4"];
  OPT24:e -> RTUESP:g25:w [color="#7a3fc4"];
  OPT24:e -> RTUESP:g27:w [color="#7a3fc4", style=dashed];
  OPT24:e -> RTUESP:g13:w [color="#7a3fc4", style=dashed];
  RTUESP:g26:w -> SHED:s1:e [color="#1e5bd8", penwidth=2.2];
  RTUESP:g19:w -> SHED:s2:e [color="#1e5bd8", penwidth=2.2, style=dashed];
  BUCK:ne -> RTUESP:v5:w [color="#d00000", penwidth=2.2, label=<5VDC  >];
  BUCK:e -> ROOM:w [color="#d00000", penwidth=2.4, label=< <BR/><B>5VDC + GND to room plate (CAT5 run if needed)</B>>];
  RAIR:n -> RTUESP:g4e:e [color="#c9a000", style=dashed];
  RTUESP:wifie:e -> PI:s [color="#178a6a", penwidth=2.6, label=<<B>Wi-Fi MQTT</B><BR/>(RTU node)>];

  // relays
  ESP:g25:e -> RLY:in1:w [color="#8a2be2", penwidth=3, label="purple"];
  ESP:g26:e -> RLY:in2:w [color="#ff8c00", penwidth=3, label="orange"];
  ESP:g27:e -> RLY:in3:w [color="#1e5bd8", penwidth=3, label="blue"];
  ESP:g33:e -> RLY:in4:w [color="#aaaaaa", penwidth=3, label="white"];
  ESP:gnd2:e -> RLY:gnd:w [color="black", penwidth=3, label="GND"];
  RLY:o1:e -> LOADS:w [color="#555555"];
  RLY:o2:e -> LOADS:w [color="#555555"];
  RLY:o4:e -> LOADS:w [color="#555555"];
  RLY:o3:e -> Y1:w    [color="#1e5bd8", penwidth=2.4];

  // network
  ESP:wifi:e -> PI:w [dir=both, color="#178a6a", penwidth=3, label=""];
  MQ [shape=plaintext, style="", POS_MQ, fontcolor="#0f5e48", label=<<B>Wi-Fi MQTT</B><BR/>bkems/{deviceKey}/telemetry (up)<BR/>bkems/{deviceKey}/cmd (down)<BR/>deviceKey = store-{id}-gw>];
  PI:e -> CC:w [dir=both, color="#178a6a", penwidth=3, label=""];
  NET [shape=plaintext, style="", POS_NET, label="internet", fontsize=12];
  ROOM:n -> PI:se [color="#178a6a", penwidth=2.4, style=dashed];
}
'''
pos = {
 'PWR': (6.4, 13.0), 'TEMP': (1.8, 10.55), 'LUX': (1.8, 8.95), 'DOOR': (1.3, 7.9), 'OPTD': (3.45, 7.9),
 'ESP': (6.4, 8.95),
 'RLY': (10.5, 9.9), 'LOADS': (14.0, 11.1), 'Y1': (14.0, 9.35),
 'PI': (12.3, 6.0), 'MQ': (9.45, 7.0), 'CC': (15.7, 6.0), 'NET': (14.05, 6.3),
 'RTUEQ': (1.9, 3.7), 'FUSE': (1.95, 1.55), 'BUCK': (1.95, 0.2), 'OPT24': (6.6, 3.77), 'SHED': (6.35, 1.82),
 'RTUESP': (10.8, 3.17), 'RAIR': (13.5, 3.12), 'ROOM': (14.9, 0.3), 'SAFE': (14.4, 7.72),
}
for k,(x,y) in pos.items(): dot = dot.replace(f'POS_{k}', P(x,y))
open('BKEMS-Wiring-Diagram.dot','w').write(dot)
print('wrote BKEMS-Wiring-Diagram.dot rev 3')

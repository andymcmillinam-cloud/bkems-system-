#!/usr/bin/env bash
# Install / update the BKEMS Pi stack. Run on the Pi from the repo's pi/ folder:  sudo bash install.sh
set -euo pipefail
cd "$(dirname "$0")"
apt-get install -y mosquitto mosquitto-clients python3-paho-mqtt python3-serial
install -d /opt/bkems/edge /opt/bkems/web/static
install -m 755 edge/bkems_serial_agent.py /opt/bkems/edge/
install -m 755 web/bkems_web.py /opt/bkems/web/
install -m 644 web/static/index.html /opt/bkems/web/static/
[ -f /etc/default/bkems ] || install -m 644 bkems.default /etc/default/bkems
install -m 644 systemd/bkems-agent.service systemd/bkems-web.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mosquitto bkems-agent bkems-web
systemctl restart bkems-agent bkems-web
systemctl --no-pager status bkems-agent bkems-web | grep -E "Active|bkems-"

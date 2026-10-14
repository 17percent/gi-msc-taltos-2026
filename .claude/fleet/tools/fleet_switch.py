#!/usr/bin/env python3
"""Fleet ON/OFF for this session or chat: `python fleet_switch.py on|off`. Prints the confirmation line only.

The guard hook sees this command (with the session id) and records the switch, so the workflow hooks (edit reminder,
Copilot stop gate) follow the owner's switch: ON in `on-demand` mode, OFF in `auto` mode. Stdlib only, no state here.
"""
import sys

arg = (sys.argv[1:] or ["on"])[0].lower()
if arg not in ("on", "off"):
    sys.exit("usage: fleet_switch.py on|off")
print("Flotta BE." if arg == "on" else "Flotta KI.")

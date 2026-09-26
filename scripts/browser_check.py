"""Run the maintained UI scenario using native navigation, without any transport shim.
Requires an isolated local running server. A policy block is a failure, never bypassed.
The separate dom_check.py path explicitly discloses its local-API test bridge.
"""
from dom_check import main
if __name__ == '__main__':main(native=True)

#!/usr/bin/env python3
"""Optional Linux/macOS guest native entry point. Browser mode needs no helper."""
import json
import sys
from guest_input_common import run

if __name__=='__main__':
    try:
        if sys.platform=='linux':
            from guest_input_linux import LinuxInput
            adapter=LinuxInput()
        elif sys.platform=='darwin':
            from guest_input_macos import MacInput
            adapter=MacInput()
        else:raise RuntimeError('This guest helper requires Linux or macOS.')
        if '--scan' in sys.argv:
            try:
                devices,notes=adapter.inventory()
                print(json.dumps({'devices':devices,'notes':notes}),flush=True)
            finally:adapter.dispose()
        else:run(adapter)
    except Exception as error:
        print(json.dumps({'type':'error','error':str(error)}),flush=True)
        sys.exit(1)

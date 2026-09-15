#!/usr/bin/env python3
"""Keep fixture credential arguments out of the captured package CLI output."""
import re
import sys

for line in sys.stdin:
    if re.search(r"mnemonic|\bseed\b|password|jwtsecret", line, re.IGNORECASE):
        sys.stdout.write("[fixture credential-bearing output omitted]\n")
    else:
        sys.stdout.write(line)
    sys.stdout.flush()

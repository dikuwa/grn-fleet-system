#!/bin/bash
cd "/Users/stunna/Dev/GRN FLEET MANAGEMENT"
node_modules/.bin/tsc --noEmit --pretty false 2>&1 | grep "error TS" > /tmp/tsc-errors.txt
echo "Exit: $?" >> /tmp/tsc-errors.txt
echo "Error count: $(grep -c 'error TS' /tmp/tsc-errors.txt)" >> /tmp/tsc-errors.txt

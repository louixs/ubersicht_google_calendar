#!/bin/bash

ping -q -c 1 -W 1 8.8.8.8 > /dev/null

# if ping -q -c 1 -W 1 8.8.8.8 > /dev/null; then
#   echo 1 #returns 1 if the address is pingable
# else
#   echo 0 #returns 0 if the address is unreacheable
# fi

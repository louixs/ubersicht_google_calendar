#!/bin/bash

# returns timezone offset hours in second
# to be accompanied with google calendar api ubersicht widget

# 1 arg needed
# date in YYYYMMDDhhmmss format add or subtract timezone offset 
# retuns YYYYMMDDhhmmss

base_sec=$(echo "$1" | ./utconv)

function calculate(){
  # picks the timezone from shell's ENV
  machineTimeZoneOffset=$(date +"%z" | sed 's/./&:/3') # this produces the time offset like +01:00
  # need to return 
  staged=$(echo "$machineTimeZoneOffset" | sed 's/.\{3\}$//') # +01
  #formatted=$(echo "$staged" | sed 's/0//' | awk '{print $0"H"}') # returns e.g. +1H or +11H
  hour_extracted=$(echo "$staged" | sed 's/+//' | sed 's/0//' | awk '{print $0""}') # retuns e.g. 1 or 11
  offset_sec=$(echo "$(($hour_extracted * 3600))")  

  #first_digit= $(echo "staged" | cut -b2) #0
  prefix=$(echo "$staged" | sed 's/0.//') #should return + or -  
  
  # if plus, subtract
  if [ "$prefix" = "+" ]; then
    result=$(( $base_sec - $offset_sec))
    
  else
    result=$(( $base_sec + $offset_sec))
  fi

  # returns the parsed timezone offset that can be used 
  echo "$result"
}

function toRFC3339(){
  # $1 first arg in %Y%m%d%H%M%S format - 20170604225959
  DATE="$1"
  result=$(date -jf "%Y%m%d%H%M%S" $DATE +"%Y-%m-%dT%H:%M:%SZ")
  echo "$result"
}


#result=$(parse "$machineTimeZoneOffset")
converted=$( calculate | ./utconv -r)

return_val=$(toRFC3339 "$converted")

echo "$return_val"


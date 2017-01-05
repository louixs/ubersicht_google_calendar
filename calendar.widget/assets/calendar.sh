#!/bin/bash

# Name: Script for Google calendar API 
# Description: Obtain google calendar events using google oauth2 for widget for Mac OSX app Übersicht
# Author: Ryuei Sasaki
# Github: https://github.com/louixs/

# -- For debugging
function runDebugLogger(){
  if [ ! -e debugLogger.sh ]; then
    cd assets
    source debugLogger.sh
  else
    source debugLogger.sh    
  fi
   # Debug function to trace all scripts run below it
  activate_debug_logger
}

# Uncomment the below to enalbe the debugger
# runDebugLogger

# If any error occurs, exit a script with exit 1
function exitIfFail(){
  #https://sanctum.geek.nz/arabesque/testing-exit-values-bash/
  if $1; then :; else exit 1; fi
}

function runOauth (){
  if [ ! -e oauth.sh ]; then
    cd assets/
    exitIfFail ./oauth.sh
  else
    exitIfFail ./oauth.sh
  fi
}

runOauth

function setVars(){
  whereAwk=$(which awk)
  whereCat=$(which cat)
  whereNetstat=$(which netstat)
  foundPaths="${whereCat///cat}:${whereAwk///awk}:${whereNetstat///netstat}"
  export PATH="$foundPaths" &&

  TOKEN_FILE=token
  ACCESS_TOKEN=$(cat "$TOKEN_FILE" | grep access_token | awk '{print $2}' | tr -d \",)
  CAL_LIST_URL="https://www.googleapis.com/calendar/v3/users/me/calendarList/?showHidden=true"
}

setVars

getCal(){
  curl -sH "Authorization: Bearer $ACCESS_TOKEN" $1
}

function getCalList(){
  local list=$( getCal $CAL_LIST_URL )
  echo $list > list.db
}
getCalList

function  getCalendarIDToShow(){
  local calendar_name=$(getCalendarNames)
  local calendarIDToShow=$(calIdByName "$calendar_name" )
  echo "$calendarIDToShow"
}

function getEventsById(){
  # Accepts 1 argument
  # $1 = calendar ID
  todayStart=$(date -u +"%Y-%m-%dT00:00:00Z")
  todayEnd=$(date -u +"%Y-%m-%dT23:59:59Z")
  
  tmrwStart=$(date -v +1d -u +"%Y-%m-%dT00:00:00Z")
  tmrwEnd=$(date -v +1d -u +"%Y-%m-%dT23:59:59Z")

  function makeCalUrl(){    
    # Expects 3 arguments
    # $1 calendar ID which should be supplied when calling the parten function 
    # $2 date in ISO8601 format
    # $3 date in ISO8601 format
    local orderBy="startTime"
    echo "https://www.googleapis.com/calendar/v3/calendars/$1/events/?timeMin=$2&timeMax=$3&singleEvents=true&orderBy=$orderBy"
  }
  
  local todayUrl=$( makeCalUrl $1 $todayStart $todayEnd )
  local tmrwUrl=$( makeCalUrl $1 $tmrwStart $tmrwEnd )
  local today=$( getCal $todayUrl )
  local tmrw=$( getCal $tmrwUrl )
  echo $today > today.db
  echo $tmrw  > tmrw.db

  function getEventTime(){
    local eventTime=$(./parsej.sh $1 | grep $2 | sed "s/.*$2[[:space:]].*/$ All Day/" | awk '{$1="";print $0"+|+"}' | sed '$s/+|+/ /g' | xargs)
    echo "$eventTime"
  }
    
  function getEventName(){
    local eventName=$(./parsej.sh $1 | grep '].summary' | sed "s/.*start.date[[:space:]].*/$ All Day/" | awk '{$1="";print $0"+|+"}' | sed '$s/+|+//g' | xargs)
    echo "$eventName"
  }
  
  todayStartTime=$(getEventTime today.db "start.date" )
  todayEndTime=$(getEventTime today.db "end.date" )
  todayTime="$todayStartTime~$todayEndTime"
  
  tmrwStartTime=$(getEventTime tmrw.db "start.date" )
  tmrwEndTime=$(getEventTime tmrw.db "end.date" )
  tmrwTime="$tmrwStartTime~$tmrwEndTime"
  
  todayEventName=$(getEventName today.db )
  tmrwEventName=$(getEventName tmrw.db )

  # ; to seperate start time and event
  # --!--  to seperate today's and tomorrow's events
  # || to seperate calendar type
  echo "$todayTime§-§$todayEventName--!--$tmrwTime§-§$tmrwEventName||"
}

function calIdByName(){
  local CAL_ID=$(./parsej.sh list.db | grep -B 1 "$1" | head -n1 | awk '{$1="";print $0}')
  echo "$CAL_ID"
}

function getCalendarNames(){
  local PARENT_DIR=${PWD%/*}
  local coffee_file="$PARENT_DIR"/calendar.coffee
  local calendar_names=$(sed -e 1b "$coffee_file" | grep CALENDAR_NAME | sed 's/.*://' | xargs)
  echo "$calendar_names"
}

function getCalIds(){
  for var in "$@"
  do
    calIdByName "$var"
  done
}

storeCalendarIDsToFile(){
  local calendar_names=$(getCalendarNames)
  if [ -z "$calendar_names"]; then
     echo 3
     exit 1
  else       
    IFS=',' read -ra names <<< "$calendar_names"
    for i in "${names[@]}"; do
      trimmed=$(echo "$i" | xargs)
      calIdByName "$trimmed"
    done > calIDs.db
  fi
}

function getEventsByCalendarIDs(){
  while read line; do
    getEventsById $line
  done < calIDs.db
}

storeCalendarIDsToFile
getEventsByCalendarIDs > calEvents.db

# send results to front end - ubersichts 
function concatEvents(){
  local events=$(
    while read line; do
      echo -n $line
    done <calEvents.db
  )
  cleaned_events=$(echo $events | sed 's/..$//')
  echo $cleaned_events
}

concatEvents

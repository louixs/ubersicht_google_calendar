#!/bin/bash

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
runDebugLogger

function setWorkingDir(){
  if [ ! -e oauth.sh ]; then
    cd assets
  else
    :
  fi
}

setWorkingDir

function readCredVar(){ #rename as this is confusing this applies to extracting all values in a file after a colon :
  #$1 = file name 
  #$2 = var name e.g. CLIENT_ID
  local credVar=$(sed -e 1b "$1" | grep "$2" | sed 's/.*://' | sed 's/"//' | sed '$s/"/ /g' | xargs)
  echo "$credVar"
}

readonly PARENT_DIR=${PWD%/*}
readonly COFFEE_FILE_NAME=$(ls ../ | grep .coffee)
readonly COFFEE_FILE="$PARENT_DIR"/"$COFFEE_FILE_NAME"
readonly GOOGLE_APP=$( readCredVar "$COFFEE_FILE" GOOGLE_APP )
readonly APP=$( echo "./$GOOGLE_APP.sh" )

function isNetworkAlive(){
  ./networkAlive.sh
}

function runApp(){
  "$APP"
}

until isNetworkAlive; do
  sleep 10
done

runApp

#!/bin/bash
# Name: Google API Oauth2 for Übersicht
# Description: Handles google oauth2 to use google API with Übersicht
# Author: Ryuei Sasaki
# Github: https://github.com/louixs/
# =====================================================
# ====     Google Oauth2 
# =============================

# -- For debugging 
source debugLogger.sh
# Debug function to trace all scripts run below it
# uncomment the below to enable the debugger:
# activate_debug_logger

function readCredVar(){ #rename as this is confusing this applies to extracting all values in a file after a colon :
  #$1 = file name 
  #$2 = var name e.g. CLIENT_ID
  local credVar=$(sed -e 1b "$1" | grep "$2" | sed 's/.*://' | sed 's/"//' | sed '$s/"/ /g' | xargs)
  echo "$credVar"
}

# Set initial variables these should not be mutated
declare -rx PARENT_DIR=${PWD%/*}
readonly COFFEE_FILE_NAME=$(ls ../ | grep .coffee)
declare -rx COFFEE_FILE="$PARENT_DIR"/"$COFFEE_FILE_NAME"
declare -rx three_DIR_UP=${PWD%/*/*/*}
declare -rx GOOGLE_APP=$( readCredVar "$COFFEE_FILE" GOOGLE_APP )
declare -rx DEV_CONFIG_FILE="$three_DIR_UP"/google_oauth_"$GOOGLE_APP".config


declare -rx SIGNAL_FILE=signal.db
declare -rx TOKEN_FILE=token.db
declare -rx R_TOKEN_FILE=r_token.db

#addresses
SCOPE=https://www.googleapis.com/auth/"$GOOGLE_APP".readonly
declare -rx REDIRECT_URI=urn:ietf:wg:oauth:2.0:oob
#================

function timeNow(){
  #output date and time for temp file name
  date +%b"_"%d"_"%a"_"%T
}

# A function that checks if a variable exists or no
function varExists(){
  # check if the variable exists or not
  if [ "$1" ]; then
     echo 1 # var exists
  else
     echo 0 # var does not exist
  fi
}

function fileExists(){
  # check if the variable exists or not
  if [ -f "$1" ] && [ -n "$1" ] ; then
     return 0 # file exists
  else
     return 1 # file does not exist
  fi
}

#Function that creates a file if the said file does not exist in the same directory
function makeFileIfNone(){
  if fileExists "$1"; then :; else touch "$1"; fi
}

function makeMultipleFiles(){
  # accepts multiple files
  # pass them as a space separated string as below
  # "$SIGNAL_FILE $LOG_FILE"
  local file
  for file in "$1"
  do
    makeFileIfNone "$file"
  done
}

function overrideLog(){
  echo "$(timeNow) ${1}" > "$LOG_FILE"
}

function appendToLog(){
  echo "$(timeNow) ${1}" >> "$LOG_FILE"
}

function signalGetAccessToken(){
  echo 'get' > "$SIGNAL_FILE"
  # write 'get' to indicate a signal to get access token next time this script file runs
}

function isSignalGet(){
  if ([ -s "$SIGNAL_FILE" ] && [ "$signal_var" -eq 'get' ]); then
    return 0
  else
    return 1
  fi
}

function setCredVars(){
  # 1. when wrapped in a function, sed doesn't spit out the error if it cannot fild value
  # 2. AUTH_URL needs to be set right after reading the variables from .coffee file, else it was not picking up correctly
  # most likely due to polluted global scope that mutates variables all the time

  # $1 = config_file location
  local FILE="$1"
  
  CLIENT_ID=$(readCredVar "$FILE" CLIENT_ID)
  CLIENT_SECRET=$(readCredVar "$FILE" CLIENT_SECRET)
  AUTHORIZATION_CODE=$(readCredVar "$FILE" AUTHORIZATION_CODE)
  AUTH_URL="https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=$CLIENT_ID&redirect_uri=$REDIRECT_URI&scope=$SCOPE&access_type=offline"
}

setupDevConfigFile(){
   makeFileIfNone "$DEV_CONFIG_FILE"
   
   if [ -s "$DEV_CONFIG_FILE" ]; then # if file has some data
     :
   else
     # if file is empty
     echo "CLIENT_ID:" >> "$DEV_CONFIG_FILE"
     echo "CLIENT_SECRET:" >> "$DEV_CONFIG_FILE"
     echo "AUTHORIZATION_CODE:" >> "$DEV_CONFIG_FILE"
   fi
}

#Make cofig file for client id, cliet secrets and authorization code if it does not exist 

function assignCredentialVars(){
  # check .coffee for credentails
  local coffee_cred_var_exists=$(
        local coffee_client_id=$(readCredVar "$COFFEE_FILE" CLIENT_ID )
        local coffee_client_secret=$(readCredVar "$COFFEE_FILE" CLIENT_SECRET )
        if [ ! -z "$coffee_client_id" ] && [ ! -z "coffee_client_secret" ] ; then
        # if both exist
          echo 1 # yes exist
        else
          echo 0 # nope
        fi
        )

  # assign credential variables if they exist in .coffee
  # and stop making google_oauth.config file
  if [ "${coffee_cred_var_exists}" -eq 1 ]; then
    setCredVars "$COFFEE_FILE"
    CONFIG_FILE="$COFFEE_FILE" # set CONFIG_FILE globaly here

    if [ -s "$DEV_CONFIG_FILE" ]; then      
      local DEV_CLIENT_ID=$(readCredVar "$DEV_CONFIG_FILE" CLIENT_ID)
      local DEV_CLIENT_SECRET=$(readCredVar "$DEV_CONFIG_FILE" CLIENT_SECRET)
      if [ ! -z "$DEV_CLIENT_ID" ] && [ ! -z "$DEV_CLIENT_SECRET"]; then        
        :
      else
        rm "$DEV_CONFIG_FILE"
      fi
    fi
    
  else
  # for dev, credentials should not be filled in .coffee file
  # make google_ouath.config outside of the app folder and set credentials from there
    setupDevConfigFile
    setCredVars "$DEV_CONFIG_FILE"
    CONFIG_FILE="$DEV_CONFIG_FILE"
  fi
}

function credCheck(){
  assignCredentialVars
  if [ ! -n "$CLIENT_ID" ] || [ ! -n "$CLIENT_SECRET" ]; then
    echo 1
    exit 1 #exit this script with error  
  elif [ -n "$CLIENT_ID" ] && [ -n "$CLIENT_SECRET" ]; then
    assignCredentialVars
  elif [ -s "$CLIENT_ID" ] && [ -s "$CLIENT_SECRET" ]; then
    assignCredentialVars
  else
    echo "Unhandled case; investigate and need to fix"
    echo "Please report this as a bug"
    exit 1
  fi
}

function checkAuthCode(){
  assignCredentialVars
  
  if  ([ -s "$CONFIG_FILE" ] && [ "$AUTHORIZATION_CODE" ]); then
    :
  elif ([ -s "$CONFIG_FILE" ] && [ -n "$AUTHORIZATION_CODE" ]); then
  # Authorization code should be needed only once first
  # once it is retrived and a valid access token is issued together with a refresh token
  # the refresh token should be used to re-new access token once it expired
    echo 2
    signalGetAccessToken
    sleep 3
    open $AUTH_URL
    exit 1
  fi
}

function readSignal(){
  if [ -s "$SIGNAL_FILE" ]; then
    signal_var=$(cat "$SIGNAL_FILE")
  else
    :
  fi
}

function removeSignalFile(){
  if [ -s "$SIGNAL_FILE" ]; then
     rm "$SIGNAL_FILE"
  else
    :
  fi
}

function checkRefreshToken(){
  REFRESH_TOKEN=$(sed -e 1b "$R_TOKEN_FILE" | grep refresh_token | sed 's/.*://' | xargs)
  local refresh_token_exists=$(varExists "$REFRESH_TOKEN")
  if [ "${refresh_token_exists}" -eq 1 ]; then      
    # curl -sd "refresh_token=$REFRESH_TOKEN&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET&grant_type=refresh_token" https://www.googleapis.com/oauth2/v4/token > $TOKEN_FILE
    # #re-assign access_token to the updated one
    # ACCESS_TOKEN=$(cat "$TOKEN_FILE" | grep access_token | awk '{print $2}' | tr -d \",)
    # removeSignalFile
    # exit 0

    # refresh token does not expire unless user revokes access to application
    # for upgrade, check for validity of refresh token here
    :
   else
     tokenExists
   fi
}

# Needs refactoring
function getToken(){
  #assign signal_var only if $SIGNAL_FILE exists
  readSignal
  tokenFileContent=$(cat "$TOKEN_FILE")  
  tokenValidity=$(sed -e 1b "$TOKEN_FILE" | head -n2 | grep error | sed 's/.*://' | sed 's/"//' | sed '$s/",/ /g')
  
  if ([ -s "$SIGNAL_FILE" ] && [ "$signal_var" == 'get' ]) || [ ! -n "$tokenFileContent" ] || [ "$tokenValidity" == "invalid_grant" ]; then
      # if the signal says get then get token first
      #get token into the file and assign variables accordingly
      curl -sd "code=$AUTHORIZATION_CODE&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET&redirect_uri=$REDIRECT_URI&grant_type=authorization_code&access_type=offline" https://www.googleapis.com/oauth2/v4/token > "$TOKEN_FILE"
      local new_access_token=$(cat "$TOKEN_FILE" | grep access_token | awk '{print $2}' | tr -d \",)
      local new_refresh_token=$(cat "$TOKEN_FILE" | grep refresh_token | awk '{print $2}' | tr -d \",)
      local refresh_token_exists=$(varExists "$new_refresh_token")

      if [ "$refresh_token_exists" -eq 1 ] ; then
        # check if the newly retrieved token actually exists to make sure        
        # write refresh token to the r_token.db file
        echo "refresh_token:$new_refresh_token" > "$R_TOKEN_FILE"
        ACCESS_TOKEN="$new_access_token"
        REFRESH_TOKEN=$(sed -e 1b "$R_TOKEN_FILE" | grep refresh_token | sed 's/.*://' | xargs)
        removeSignalFile
      else
        #if token varibles are empty, then need a new authorization code and get them      
        signalGetAccessToken
        echo 2
        sleep 3
        open "$AUTH_URL"
        exit 1
      fi    

    #removing temp signal file
    removeSignalFile
  
  else
    : #do nothing, if you don't add this you get error
  fi
}

# check access token
function tokenExists(){
  #assigning token variables to use for checks
  ACCESS_TOKEN=$(cat "$TOKEN_FILE" | grep access_token | awk '{print $2}' | tr -d \",)
  REFRESH_TOKEN=$(sed -e 1b "$R_TOKEN_FILE" | grep refresh_token | sed 's/.*://' | xargs)
 
  if ([ -s "$TOKEN_FILE" ] && [ "${ACCESS_TOKEN}" ]); then
    removeSignalFile
  elif ([ -s "$TOKEN_FILE" ] && [ -n "${ACCESS_TOKEN}" ]); then
    # if refresh token exists, use refresh token to get access token
    refresh_token_exists=$(varExists "$REFRESH_TOKEN")
    removeSignalFile
    if [ "${refresh_token_exists}" -eq 1 ]; then
       local new_token=$(curl -sd "refresh_token=$REFRESH_TOKEN&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET&grant_type=refresh_token" https://www.googleapis.com/oauth2/v4/token) > "$TOKEN_FILE"
      #re-assign access_token to the updated one        
       local new_access_token=$(cat "$TOKEN_FILE" | grep access_token | awk '{print $2}' | tr -d \",)
       local new_refresh_token=$(cat "$TOKEN_FILE" | grep refresh_token | awk '{print $2}' | tr -d \",)

       # check if the new access token exists to see if the valid authorization code was used
       # if the new access token is empty, need to get a new authorization and then get a new access token
       local token_exists=$(varExists "$new_access_token")
       
       if [ "${token_exists}" -eq 1 ]; then
         #save refresh_token to file
         echo "refresh_token:$new_refresh_token" > r_token.db
         #assign token
         ACCESS_TOKEN="$new_access_token"
         REFRESH_TOKEN=$(sed -e 1b "$R_TOKEN_FILE" | grep refresh_token | sed 's/.*://' | xargs)
         removeSignalFile
         exit 0
       else
         echo "Copy the code from the browser and paste it right after AUTHORIZATION_CODE: in the .coffee file"
         echo "Once the code is pasted in , re-run this script"         
         signalGetAccessToken
         sleep 3         
         open "$AUTH_URL"         
         exit 1 
       fi    
    else
      #if refresh token is also missing, then get a new token
      #for than you'd need to get a new authorizaiton code anyways
      echo "Copy the code from the browser and paste it right after AUTHORIZATION_CODE: in the .coffee file"
      echo "Once the code is pasted in , re-run this script"
      signalGetAccessToken
      sleep 3
      open "$AUTH_URL"
      
      exit 1
    fi   
  fi
}

function checkTokenStatus(){
    # first, check if it is expired
    local status=$(curl -sL "https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=$ACCESS_TOKEN" | grep "expires_in")
    # this returns some values like 3600 if it's still valid
    # if not it returns nothing
    
    # check that the access token is not expired...    
    # once passed this test, finally do some cool stuff
    if [ -n "${status}" ] ; then    
      exit 0 #0 success exit      
    else
    # if the acess token is expired, get the new access key using the refresh token
      refresh_token_exists=$(varExists "$REFRESH_TOKEN")

      if [ "${refresh_token_exists}" -eq 1 ]; then
      
        curl -sd "refresh_token=$REFRESH_TOKEN&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET&grant_type=refresh_token" https://www.googleapis.com/oauth2/v4/token > "$TOKEN_FILE"
      #re-assign access_token to the updated one
        ACCESS_TOKEN=$(cat "$TOKEN_FILE" | grep access_token | awk '{print $2}' | tr -d \",)
      else
        tokenExists
      fi
    fi
}

# Read client id and secrets first in case they alreay exists for later usage
# IMPORTANT
assignCredentialVars

# Make necessary files if they don't exist
makeMultipleFiles "$TOKEN_FILE" "$R_TOKEN_FILE"

# Check if credntials are filled in
# .coffee is where you store your CLIENT_ID, CLINET_SECRET and Authorization_code
credCheck

# check if authorization code exists
# If exists, go to next action
# If it doesn't exists it will prompt you to get one and fill it in to a relevant file
checkAuthCode

# check if refresh token exists and its validiy
checkRefreshToken

# if refresh token is there, check if access key is expired or not
# if access key is expired, use refresh token to get a new access key
getToken

# if for some reason, access key is empty or not valid after using refresh key
# get a new authoriation code and get a new access key and refresh token

tokenExists

checkTokenStatus

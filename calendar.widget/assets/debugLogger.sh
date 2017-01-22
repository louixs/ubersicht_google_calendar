#!/bin/bash

# Name: Bash scripts debug logger
# recordToLog.sh
# Description: This script takes the name of the script that executes activate_debug_logger function and put it into the name of the log files
# Author: Ryuei Sasaki
# Github: https://github.com/louixs/

# Usage:
# Source this script as following and call the activate_debug_logger function in the script.
# Supply the name of the log file i.e. source recordToLog.sh 
# Or, just include the below to your script that you want to debug:
# -----
# source debugLogger.sh
# activate_debug_logger
# -----
# Currently, it is intended to be used only when you want to debug.

# Disclaimer:
# Use with your own risk. The logger records everything that your script runs including credentials, password etc.
# Currently, it has no security measures. Please do be aware of this. 
# Currently the logger just accumulate logs and does no manage the logs
# Use with caution.

# Todos/Next steps
# • Check the size of the log folder if it is above certain size, delete the older logs
# • Implement security measures i.e. gzip the log folder for secuirty
# • Implement continuous logging without having to manually activate in order to trace and debug a bug that could occur 1 in a million times

#---- Start
# For dynamically making log directory
# Including this for portability
function dirExists(){
  (if [ -d $1 ] ; then
    return 0 # directory exists
  else
    return 1 # directory does not exist
  fi)
}

function makeDirIfNone(){
  (if dirExists $1; then :; else mkdir $1; fi)
}

# Debugger function
function activate_debug_logger(){
  time=$(date +%Y-%m-%d_%H:%M:%S)

  LOG_DIR_NAME=log
  makeDirIfNone "$LOG_DIR_NAME"
  
  DEBUG_FILE_NAME=${0##*/}
  #$(echo "$0" | sed 's/.\///')
  LOG_FILE_NAME="$DEBUG_FILE_NAME"_"$$"_"$time".log #e.g. oauth
  exec 2> "$LOG_DIR_NAME"/"$LOG_FILE_NAME"
  set -vx
}
#---- End

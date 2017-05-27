#!/bin/bash

function fileExists(){
  # check if the variable exists or not
  if [ -f $1 ] && [ -n $1 ] ; then
     return 0 # file exists
  else
     return 1 # file does not exist
  fi
}

folder=$1

rm "$folder"/assets/*.db
echo ".db files removed"
rm -r "$folder"/assets/log
echo "log files removed"

if fileExists "$folder".zip; then
  rm "$folder".zip
  zip -r "$folder".zip  "$folder"
  echo "deleted existing .zip and re-zipped"
else
  zip -r "$folder".zip  "$folder"
  echo "re-zipped"
fi


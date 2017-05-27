#!/bin/bash

folder=$1

if fileExists "$folder".zip; then
  rm "$folder".zip
  zip -r "$folder".zip  "$folder"
  echo "deleted existing .zip and re-zipped"
else
  zip -r "$folder".zip  "$folder"
  echo "re-zipped"
fi


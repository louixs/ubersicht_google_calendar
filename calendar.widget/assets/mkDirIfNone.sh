#!/bin/bash

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

makeDirIfNone $1

#!/bin/bash

# For adding the whole stack, add a commit message and push from origin to master

folder=$1 #folder in which log and .db files to be removed to make sure

rm "$folder"/assets/*.db
echo ".db files removed"
rm -r "$folder"/assets/log
echo "log files removed"


git add .
git commit -m "$2"
git push origin master

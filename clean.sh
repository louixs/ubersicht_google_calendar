#!/bin/bash

# clean
# ensure not sensitive data is commited
# run this with pre-commit hook

folder=$1

rm "$folder"/assets/*.db
echo ".db files removed"
rm -r "$folder"/assets/log
echo "log files removed"

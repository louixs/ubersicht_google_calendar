#!/bin/bash

# For adding the whole stack, add a commit message and push from origin to master

git add .
git commit -m "$1"
git push origin master

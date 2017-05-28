# Name: Google Calendar for Übersicht using oauth2
# Description: Obtain google calendar events using google oauth2 for widget for Mac OSX app Übersicht. Sorts and displays events for today and tomorrow based on user's Google calendar's timezone. Allows multiple google calendars in user's calendar list.
# Author: Ryuei Sasaki
# Github: https://github.com/louixs/

# Dependencies. Best to leave them alone.
_ = require('./assets/lib/underscore.js');

GOOGLE_APP:"calendar"

#==== Google API Credentials ====
# Fill in your Google API cleint id and client secret
# Save this file and a browser should launch asking you to allow widget to access google calendar
# Once you allow, you will be presented with your Authorization code. Please fill it in and save the file.
# Your calendar events should now show. If not try refreshing Übersicht.
# If you don't have your client id and/or client secret, please follow the steps in the Setup section in README.md.

CLIENT_ID:""
CLIENT_SECRET:""
AUTHORIZATION_CODE:""

#==== Calendar Name
# Place calendar names seperated with commas.
# i.e. "Calendar_1, Calendar_2, Calendar_3, Calendar Name 4"
# Calendar names are case sensitive.
CALENDAR_NAME:""
#====

command:"""
  if [ ! -d assets ]; then
    cd "$PWD"/calendar.widget
    "$PWD"/assets/run.sh
  else
    "$PWD"/run.sh
  fi
"""

refreshFrequency: '30m' #30 min.
#Other permitted formats: '2 days', '1d', '10h', '2.5 hrs', '2h', '1m', or '5s'

#<div id="divider">~~~~~~~~~~~~~~~~</div>
render: (output) -> """  
  <div class="container"></div>
  <script src="http://cdnjs.cloudflare.com/ajax/libs/underscore.js/1.8.3/underscore-min.js"></script>
"""

update: (output, domEl)-> 
  show=(item)-> # for debugging
    console.log(item)

  #zip #https://cedricruiz.me/blog/functional-coffeescript-for-the-impatient/
  zip = (xss...) -> xss[0].map (_, i) -> xss.map (xs) -> xs[i]

  # Clear DOM upon every update to avoid duplicated display
  $(domEl).find(".container").empty()

  trimSpaceOfStringInNestedArr=(arr)->
    _.map(arr,(innerArr)-> _.map(innerArr, (item)-> item.trim()))        
  #--

  trimSpaceOfStringInArr=(arr)->
     _.map(arr, (item)-> item.trim())        
    
  parseHoursMins=(time)->
    #time = e.g. "2017-01-02T13:00:00Z"
    d= new Date(time)
    mins = ('0'+d.getMinutes()).slice(-2)
    hoursMinsParsed="#{d.getHours()}:#{mins}"
    if hoursMinsParsed == "0:00"
      return "0#{hoursMinsParsed}"
    else
      return hoursMinsParsed

  parseTime=(arr)->
    _.map(arr, (innerArr)-> # O(N^2); improve
        _.map(innerArr, (item)->                                    
               if item == "All Day"
                 return item               
               else
                 return parseHoursMins(item)))

  
  splitClean=(data, pos)->
      return trimSpaceOfStringInArr(data[pos].split(","))    
  
  getStartEndTime=(data)->  
    time=data.split("§-§")[0].split("~")
    splitClean=(data, pos)->
        return trimSpaceOfStringInArr(data[pos].split("+|+"))    
    startTime=splitClean(time, 0)
    endTime=splitClean(time, 1)
    zippedStartAndEndTime= zip startTime, endTime
    timeAllDayConcat= _.map(zippedStartAndEndTime, (item)-> _.unique(item))
    convertedTime=parseTime(timeAllDayConcat)
    returnTime= _.chain(convertedTime)
                 .map((arrWithin)->                    
                      if _.size(arrWithin) > 1                      
                        arrWithin.join("~")
                      else if _.size(arrWithin) == 1
                        _.map(arrWithin, (item)->
                          if item isnt "All Day"
                            return "#{item}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"
                          else
                            return item)
                      else
                        arrWithin)
                 .flatten()
                 .value()
    return returnTime
  
  zipTimeAndEvent=(data,pos)->
    inputData=data[pos]    
    time=getStartEndTime(inputData)    
    eventName=inputData.split("§-§")[1].split("+|+")
    arr= zip time, eventName    
    return arr

  #- The first processing for the output data directly from the shell command
  splitMultiCalendar=->
    calendarData=output.split("||")
    return calendarData
    
  getEventsPerCal=(cal,pos)->
     #pos 0 is today, pos 1 is tmrw
    split_calendar=cal.split("--!--")
    evts=zipTimeAndEvent(split_calendar,pos)
    return evts
  
  flattenOneLevel=(nestedArr)->
    resArr=[]
    for item in nestedArr
      for i in item
       resArr.push i    
    return resArr
  
  getEvents=(todayOrTmrw)->
    # Param todayOrTmrw:
    # 0 for today
    # 1 for tomorrow
    calArr=splitMultiCalendar()
    eventsArr=[]
    for cal in calArr
      eventsArr.push getEventsPerCal(cal,todayOrTmrw)          
    return eventsArr

   removeEmptyItem=(arr)->
     returnArr= _.chain(arr)
                 .reject((item)-> _.contains(item,""))               
                 .value()
     return returnArr
    
  addSpaceToAllDay=(arr)->
    _.map(arr, (innerArr)->
          _.map(innerArr, (item)->                                    
                 if item == "All Day"
                   return "#{item}&nbsp;&nbsp;&nbsp;&nbsp;"
                 else                 
                   return item))
                     
  sortArrForDisplay=(arr)->    
    trimmedArr= _.map(arr,(innerArr)-> _.map(innerArr, (item)-> item.trim()))        
    sortedArrAllDayLast=_.sortBy(trimmedArr, (item)-> item)
    sortedArrGroupedTwoItems=_.chain(sortedArrAllDayLast)
                              .partition((item)-> _.contains(item, "All Day"))
                              .value()          
    sortedArr=flattenOneLevel(sortedArrGroupedTwoItems)
    cleanedArr=removeEmptyItem(sortedArr)
    formattedArr=addSpaceToAllDay(cleanedArr)
    return formattedArr
  #--

  makeHTMLTitle=(title)->
    return titleToAdd="<div class=title>#{title}</div>"
    
  
  addArrToDom = (title,arr)->
    titleToAdd=makeHTMLTitle(title)
    $(domEl).find(".container").append(titleToAdd)        
    for element,index in arr
      itemToAdd="<div class=item#{index}>#{arr[index].join(" ")}</div>" 
      $(domEl).find(".container").append(itemToAdd)

  addStrToDom = (title, str) ->
    titleToAdd=makeHTMLTitle(title)
    $(domEl).find(".container").append(titleToAdd)
    $(domEl).find(".container").append(str)
    
  addItemsFilterNoEventsDay=(arr, title)->
    arrSize=_.size(arr)
    if arrSize is 0
      addStrToDom(title, "No events")            
      # enhancement idea - add radom tips for activities (from some sites or hard coded?)
      # or maybe take some stuff from timeout?
      # addStrToDom(title, "No events. How about (fill in the blank)?")
    else
      addArrToDom(title, arr)

  addCalItemsToDom=->
    todayArr=flattenOneLevel(getEvents(0))     
    tmrwArr=flattenOneLevel(getEvents(1))
    sortedTodayArr=sortArrForDisplay(todayArr)
    sortedTmrwArr=sortArrForDisplay(tmrwArr)
     
    addToday=()->
      addItemsFilterNoEventsDay(sortedTodayArr, "-- Today -----")
              
     addTmrw=()->
      addItemsFilterNoEventsDay(sortedTmrwArr, "<br> -- Tomorrow --")
    addToday()
    addTmrw()

  makeDomClassP=(text)->
     "<div class=p>#{text}</p>"

  addErrMsgToDom=(text)->
     elemToAdd=makeDomClassP(text)      
     $(domEl).find(".container").html(elemToAdd)      

  showCalendarItemsIfErrorFree=->
     if parseInt(output) is 1
       errMsg="Please fill in google_oauth.config file (found 2 directories up. If you install .widget folder in the standard übersicht location, it will be in Library/Application Support/Übersicht/widgets) with Client ID and Client secret. Please save and click on Refresh All Widgets from the Übersicht menu. Once you save and have a valid set of client ID/secret, a browser should launch and ask whether you want to allow your app to access google calendar. Please allow and you will be presented with Authorization code. If you don't have Client ID/secret, you would need to generate them on your google developer console. http://console.developers.google.com"
       addErrMsgToDom(errMsg)
     else if parseInt(output) is 2
       errMsg="A browser window launches asking if you would like to allow your app. Click Allow and your authorization code will be shown. Please copy the code and paste it in .coffee file. Once it is done please save this file to let Übersicht reload or/and use Refresh All Widgets again to reload."
       addErrMsgToDom(errMsg)
     else if parseInt(output) is 3
       errMsg="Please put calendar names, seperated with commas, in the .coffee file. And save this file and/or refresh Übersicht."
       addErrMsgToDom(errMsg)
     else
       addCalItemsToDom()       

  showCalendarItemsIfErrorFree()
    
# the CSS style for this widget, written using Stylus
# (http://learnboost.github.io/stylus/)
style: """
  //-webkit-backdrop-filter: blur(20px)
  @font-face
    font-family: 'hack'
    src: url('assets/lib/hack.ttf')
  font-family: hack, Andale Mono, Melno, Monaco, Courier, Helvetica Neue, Osaka
  color: #df740c  //#7eFFFF
  font-weight: 100
  font-size: 11 px
  top: 15%
  left: 2%
  line-height: 1.5
  //margin-left: -40px
  //padding: 120px 20px 20px
  
  .title
    color: #ffe64d //#6fc3df 
    text-shadow: 0 0 1px rgba(#000, 0.5)  
"""

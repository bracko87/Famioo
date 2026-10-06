const ICS=`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Famioo//Calendar Connections Test//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:Famioo ICS Test
X-WR-TIMEZONE:Europe/Berlin

BEGIN:VEVENT
UID:famioo-test-timed-1@famioo
DTSTAMP:20261006T131500Z
DTSTART;TZID=Europe/Berlin:20261007T100000
DTEND;TZID=Europe/Berlin:20261007T110000
SUMMARY:Famioo ICS Test Meeting
DESCRIPTION:This is a test meeting imported through the Famioo ICS connection.
LOCATION:Test Location
STATUS:CONFIRMED
END:VEVENT

BEGIN:VEVENT
UID:famioo-test-allday-1@famioo
DTSTAMP:20261006T131500Z
DTSTART;VALUE=DATE:20261008
DTEND;VALUE=DATE:20261009
SUMMARY:Famioo ICS All-day Test
DESCRIPTION:All-day test event.
STATUS:CONFIRMED
END:VEVENT

BEGIN:VEVENT
UID:famioo-test-recurring-1@famioo
DTSTAMP:20261006T131500Z
DTSTART;TZID=Europe/Berlin:20261009T180000
DTEND;TZID=Europe/Berlin:20261009T190000
RRULE:FREQ=WEEKLY;COUNT=4
SUMMARY:Famioo Weekly Test
DESCRIPTION:Recurring weekly test event.
LOCATION:Home
STATUS:CONFIRMED
END:VEVENT

END:VCALENDAR
`

Deno.serve((req)=>{
  if(req.method!=="GET"&&req.method!=="HEAD"){
    return new Response("Method not allowed",{status:405})
  }

  return new Response(req.method==="HEAD"?null:ICS,{
    status:200,
    headers:{
      "Content-Type":"text/calendar; charset=utf-8",
      "Cache-Control":"no-store",
      "Access-Control-Allow-Origin":"*",
    },
  })
})

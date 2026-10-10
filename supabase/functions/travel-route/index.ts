import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,x-client-info,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"}
function reply(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...headers,"Content-Type":"application/json"}})}
type RouteRequest={household_id?:string;trip_id?:string;origin?:string|{latitude:number;longitude:number};destination?:string;departure_time?:string}
function waypoint(place:string|{latitude:number;longitude:number}){
  if(typeof place==="string")return {address:place}
  return {location:{latLng:{latitude:place.latitude,longitude:place.longitude}}}
}
Deno.serve(async request=>{
  if(request.method==="OPTIONS")return new Response(null,{headers})
  if(request.method!=="POST")return reply({error:"Method not allowed"},405)
  const authorization=request.headers.get("Authorization")||""
  if(!authorization.startsWith("Bearer "))return reply({error:"Authentication required"},401)
  const endpoint=Deno.env.get("SUPABASE_URL")||""
  const key=Deno.env.get("SUPABASE_ANON_KEY")||""
  if(!endpoint||!key)return reply({error:"Supabase client not configured"},503)
  const client=createClient(endpoint,key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}})
  const {data:auth,error:authError}=await client.auth.getUser()
  if(authError||!auth.user)return reply({error:"Not authenticated"},401)
  let input:RouteRequest
  try{input=await request.json()}catch{return reply({error:"Invalid request"},400)}
  const householdId=String(input.household_id||"")
  if(!/^[0-9a-f-]{36}$/i.test(householdId))return reply({error:"Invalid household"},400)
  const {data:membership,error:memberError}=await client.from("household_members").select("household_id").eq("household_id",householdId).eq("user_id",auth.user.id).eq("status","active").maybeSingle()
  if(memberError||!membership)return reply({error:"No household access"},403)
  let destination=typeof input.destination==="string"?input.destination.trim():""
  let tripTitle=""
  if(input.trip_id){
    const t=await client.from("family_trips").select("title,destination").eq("household_id",householdId).eq("id",input.trip_id).maybeSingle()
    if(t.error||!t.data)return reply({error:"Trip not accessible"},403)
    destination=t.data.destination;tripTitle=t.data.title
  }else if(!destination){
    const today=new Date().toISOString().slice(0,10)
    const t=await client.from("family_trips").select("title,destination,start_date").eq("household_id",householdId).gte("end_date",today).order("start_date",{ascending:true}).limit(1)
    if(t.error)return reply({error:"Cannot access saved trips"},403)
    destination=t.data?.[0]?.destination||"";tripTitle=t.data?.[0]?.title||""
  }
  if(!destination||destination.length>350)return reply({error:"Save or specify a trip destination first"},400)
  const origin=input.origin
  if(!(typeof origin==="string"&&origin.trim().length>3&&origin.length<=350)&&!(typeof origin==="object"&&origin!==null&&Number.isFinite(origin.latitude)&&Number.isFinite(origin.longitude)&&Math.abs(origin.latitude)<=90&&Math.abs(origin.longitude)<=180))return reply({error:"Allow location access or enter a starting address"},400)
  const dep=input.departure_time?new Date(input.departure_time):null
  if(dep&&(!Number.isFinite(dep.getTime())||dep.getTime()<Date.now()-120000||dep.getTime()>Date.now()+6*86400000))return reply({error:"Departure time must be within the next six days"},400)
  const apiKey=Deno.env.get("GOOGLE_MAPS_ROUTES_API_KEY")
  if(!apiKey)return reply({error:"Google Maps routing is not configured. Add GOOGLE_MAPS_ROUTES_API_KEY to Supabase Edge Function secrets."},503)
  const googleBody:Record<string,unknown>={origin:waypoint(origin as string|{latitude:number;longitude:number}),destination:{address:destination},travelMode:"DRIVE",routingPreference:"TRAFFIC_AWARE",computeAlternativeRoutes:true,languageCode:"en"}
  if(dep)googleBody.departureTime=dep.toISOString()
  let response:Response
  try{response=await fetch("https://routes.googleapis.com/directions/v2:computeRoutes",{method:"POST",headers:{"Content-Type":"application/json","X-Goog-Api-Key":apiKey,"X-Goog-FieldMask":"routes.duration,routes.staticDuration,routes.distanceMeters,routes.description,routes.routeLabels"},body:JSON.stringify(googleBody),signal:AbortSignal.timeout(14000)})}
  catch{return reply({error:"Traffic provider temporarily unavailable"},502)}
  const data=await response.json().catch(()=>({}))
  if(!response.ok){console.error("Maps Routes request error",response.status);return reply({error:response.status===403?"Google Maps Routes API is not enabled or has invalid billing/key restrictions.":"Route provider could not calculate this route."},502)}
  const routes=Array.isArray(data.routes)?data.routes:[]
  if(!routes.length)return reply({error:"No drivable route found"},404)
  const seconds=(duration:unknown)=>typeof duration==="string"?Math.round(Number(duration.replace(/s$/,""))):null
  return reply({provider:"Google Maps Routes API",retrieved_at:new Date().toISOString(),destination,trip_title:tripTitle||null,departure_time:dep?.toISOString()||"now",
    traffic_type:dep?"traffic-aware forecast, not live conditions at departure":"traffic-aware current estimate",
    routes:routes.slice(0,3).map((route:any)=>({distance_km:Math.round((Number(route.distanceMeters)||0)/1000),duration_minutes:seconds(route.duration)!=null?Math.round(seconds(route.duration)!/60):null,baseline_minutes:seconds(route.staticDuration)!=null?Math.round(seconds(route.staticDuration)!/60):null,description:String(route.description||""),labels:route.routeLabels||[]})),
    navigation_url:"https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(destination)+"&travelmode=driving",
    warning:"Traffic estimates change. No verified incidents or road closures were supplied by this route request. Navigation app is required for live guidance."})
})

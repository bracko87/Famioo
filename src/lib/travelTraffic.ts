import { supabase } from './supabase'

export type TrafficRoute={distance_km:number;duration_minutes:number|null;baseline_minutes:number|null;description:string;labels:string[]}
export type TrafficResult={provider:string;retrieved_at:string;destination:string;trip_title:string|null;departure_time:string;traffic_type:string;routes:TrafficRoute[];navigation_url:string;warning:string}
export function askForCurrentPosition():Promise<{latitude:number;longitude:number}>{
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation){reject(new Error('Location is not supported on this device. Enter a starting address instead.'));return}
    navigator.geolocation.getCurrentPosition(
      position=>resolve({latitude:position.coords.latitude,longitude:position.coords.longitude}),
      error=>reject(new Error(error.code===1?'Location permission was declined. You can enter a starting address instead.':'Location unavailable. Enter a starting address instead.')),
      {enableHighAccuracy:false,timeout:12000,maximumAge:60000},
    )
  })
}
export async function getTravelTraffic(householdId:string,args:{trip_id?:string;origin?:string|{latitude:number;longitude:number};destination?:string;departure_time?:string}):Promise<TrafficResult>{
  const origin=args.origin??await askForCurrentPosition()
  const {data,error}=await supabase.functions.invoke('travel-route',{body:{...args,origin,household_id:householdId}})
  if(error){
    let detail=error.message
    const response=(error as {context?:Response}).context
    if(response)try{const payload=await response.clone().json() as {error?:string};if(payload.error)detail=payload.error}catch{}
    throw new Error(detail)
  }
  if(!data?.routes?.length)throw new Error('No route returned')
  return data as TrafficResult
}
export function summarizeTraffic(result:TrafficResult){
  const rows=result.routes.map((r,index)=>{
    const delay=r.duration_minutes!=null&&r.baseline_minutes!=null?r.duration_minutes-r.baseline_minutes:null
    return 'Route '+(index+1)+': '+r.distance_km+' km, '+(r.duration_minutes??'unknown')+' minutes driving'+
      (delay!=null?', difference versus baseline '+delay+' minutes':'')+
      (r.description?', '+r.description:'')
  }).join('; ')
  return result.traffic_type+' to '+result.destination+', checked '+result.retrieved_at+'. '+rows+'. '+result.warning
}

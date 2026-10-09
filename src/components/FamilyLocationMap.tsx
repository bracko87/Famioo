import { useMemo } from 'react'

export type FamilyMapMember={
  profile_id:string
  display_name:string
  latitude:number
  longitude:number
  accuracy_m:number|null
  color_key:string
}

export type FamilyMapSafePlace={
  id:string
  name:string
  latitude:number
  longitude:number
  radius_m:number
  place_type:string
}

type Props={
  members:FamilyMapMember[]
  safePlaces:FamilyMapSafePlace[]
}

const TILE=256
const VIEW_W=800
const VIEW_H=460
const MAX_LAT=85.05112878

function project(latitude:number,longitude:number,zoom:number){
  const lat=Math.max(-MAX_LAT,Math.min(MAX_LAT,latitude))
  const scale=TILE*Math.pow(2,zoom)
  const x=(longitude+180)/360*scale
  const sin=Math.sin(lat*Math.PI/180)
  const y=(0.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*scale
  return {x,y}
}

function metersPerPixel(latitude:number,zoom:number){
  return Math.cos(latitude*Math.PI/180)*2*Math.PI*6378137/(TILE*Math.pow(2,zoom))
}

function mapLayout(members:FamilyMapMember[],safePlaces:FamilyMapSafePlace[]){
  const coordinates=[
    ...members.map((member)=>({latitude:member.latitude,longitude:member.longitude})),
    ...safePlaces.map((place)=>({latitude:place.latitude,longitude:place.longitude})),
  ]

  if(!coordinates.length){
    return {
      zoom:2,
      center:{latitude:20,longitude:0},
      topLeft:{x:0,y:0},
    }
  }

  for(let zoom=16;zoom>=2;zoom--){
    const projected=coordinates.map((point)=>project(point.latitude,point.longitude,zoom))
    const minX=Math.min(...projected.map((point)=>point.x))
    const maxX=Math.max(...projected.map((point)=>point.x))
    const minY=Math.min(...projected.map((point)=>point.y))
    const maxY=Math.max(...projected.map((point)=>point.y))

    if(maxX-minX<=VIEW_W-150&&maxY-minY<=VIEW_H-130){
      const centerPixel={x:(minX+maxX)/2,y:(minY+maxY)/2}
      const longitude=centerPixel.x/(TILE*Math.pow(2,zoom))*360-180
      const n=Math.PI-2*Math.PI*centerPixel.y/(TILE*Math.pow(2,zoom))
      const latitude=180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n)))
      return {
        zoom,
        center:{latitude,longitude},
        topLeft:{x:centerPixel.x-VIEW_W/2,y:centerPixel.y-VIEW_H/2},
      }
    }
  }

  const latitude=coordinates.reduce((sum,point)=>sum+point.latitude,0)/coordinates.length
  const longitude=coordinates.reduce((sum,point)=>sum+point.longitude,0)/coordinates.length
  const zoom=2
  const centerPixel=project(latitude,longitude,zoom)
  return {
    zoom,
    center:{latitude,longitude},
    topLeft:{x:centerPixel.x-VIEW_W/2,y:centerPixel.y-VIEW_H/2},
  }
}

function colorFromKey(value:string){
  const colors=['#8c56c7','#4ba889','#de7a4f','#5878d5','#b95a8f','#72934d','#c34d62','#4e91a7']
  let hash=0
  for(let index=0;index<value.length;index++) hash=(hash*31+value.charCodeAt(index))|0
  return colors[Math.abs(hash)%colors.length]
}

export function FamilyLocationMap({members,safePlaces}:Props){
  const layout=useMemo(()=>mapLayout(members,safePlaces),[members,safePlaces])
  const tiles=useMemo(()=>{
    const minTileX=Math.floor(layout.topLeft.x/TILE)
    const maxTileX=Math.floor((layout.topLeft.x+VIEW_W)/TILE)
    const minTileY=Math.floor(layout.topLeft.y/TILE)
    const maxTileY=Math.floor((layout.topLeft.y+VIEW_H)/TILE)
    const total=Math.pow(2,layout.zoom)
    const result:{key:string;href:string;x:number;y:number}[]=[]

    for(let tileY=minTileY;tileY<=maxTileY;tileY++){
      if(tileY<0||tileY>=total) continue
      for(let tileX=minTileX;tileX<=maxTileX;tileX++){
        const sourceX=((tileX%total)+total)%total
        result.push({
          key:tileX+'-'+tileY,
          href:`https://tile.openstreetmap.org/${layout.zoom}/${sourceX}/${tileY}.png`,
          x:tileX*TILE-layout.topLeft.x,
          y:tileY*TILE-layout.topLeft.y,
        })
      }
    }

    return result
  },[layout])

  if(!members.length&&!safePlaces.length){
    return (
      <div className="family-map-empty">
        <span>No shared locations yet.</span>
        <small>Turn on location sharing or create a Safe Place to populate the family map.</small>
      </div>
    )
  }

  return (
    <div className="family-map-shell">
      <svg
        className="family-map-svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label="Family location map"
        preserveAspectRatio="xMidYMid slice"
      >
        <rect width={VIEW_W} height={VIEW_H} fill="#ece8ee"/>

        {tiles.map((tile)=>(
          <image
            key={tile.key}
            href={tile.href}
            x={tile.x}
            y={tile.y}
            width={TILE}
            height={TILE}
            preserveAspectRatio="none"
          />
        ))}

        <rect width={VIEW_W} height={VIEW_H} fill="rgba(255,255,255,.06)"/>

        {safePlaces.map((place)=>{
          const point=project(place.latitude,place.longitude,layout.zoom)
          const x=point.x-layout.topLeft.x
          const y=point.y-layout.topLeft.y
          const radius=Math.max(14,Math.min(115,place.radius_m/metersPerPixel(place.latitude,layout.zoom)))
          return (
            <g key={'place-'+place.id}>
              <circle cx={x} cy={y} r={radius} fill="rgba(143,80,161,.11)" stroke="rgba(126,69,146,.55)" strokeWidth="2" strokeDasharray="6 5"/>
              <circle cx={x} cy={y} r="8" fill="#7d4b92" stroke="#fff" strokeWidth="3"/>
              <rect x={x+12} y={y-14} width={Math.max(70,place.name.length*7+18)} height="27" rx="10" fill="rgba(255,255,255,.94)" stroke="rgba(98,75,104,.16)"/>
              <text x={x+21} y={y+4} fontSize="12" fontWeight="700" fill="#594a5e">{place.name}</text>
            </g>
          )
        })}

        {members.map((member)=>{
          const point=project(member.latitude,member.longitude,layout.zoom)
          const x=point.x-layout.topLeft.x
          const y=point.y-layout.topLeft.y
          const color=colorFromKey(member.color_key||member.profile_id)
          const initial=member.display_name.trim().slice(0,1).toUpperCase()||'?'
          const labelWidth=Math.max(78,member.display_name.length*7+24)
          return (
            <g key={'member-'+member.profile_id}>
              {member.accuracy_m!=null&&(
                <circle
                  cx={x}
                  cy={y}
                  r={Math.max(9,Math.min(90,member.accuracy_m/metersPerPixel(member.latitude,layout.zoom)))}
                  fill={color}
                  fillOpacity=".10"
                  stroke={color}
                  strokeOpacity=".28"
                  strokeWidth="1.5"
                />
              )}
              <circle cx={x} cy={y} r="18" fill="#fff" stroke={color} strokeWidth="4"/>
              <circle cx={x} cy={y} r="13" fill={color}/>
              <text x={x} y={y+5} textAnchor="middle" fontSize="13" fontWeight="800" fill="#fff">{initial}</text>
              <rect x={x-labelWidth/2} y={y+24} width={labelWidth} height="27" rx="11" fill="rgba(255,255,255,.96)" stroke="rgba(80,62,86,.15)"/>
              <text x={x} y={y+42} textAnchor="middle" fontSize="11" fontWeight="700" fill="#514657">{member.display_name}</text>
            </g>
          )
        })}
      </svg>

      <a
        className="family-map-attribution"
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
      >
        © OpenStreetMap contributors
      </a>
    </div>
  )
}

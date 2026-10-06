const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type",
  "Access-Control-Allow-Methods":"POST,OPTIONS",
}

Deno.serve((req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors})
  return new Response(JSON.stringify({
    error:"Direct Microsoft and Google calendar connections have been retired. Use Famioo Work Calendar import instead.",
  }),{
    status:410,
    headers:{...cors,"Content-Type":"application/json"},
  })
})

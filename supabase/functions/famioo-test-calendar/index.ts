Deno.serve(()=>{
  return new Response("Famioo test calendar feed retired.",{
    status:410,
    headers:{"Content-Type":"text/plain; charset=utf-8"},
  })
})

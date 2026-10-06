Deno.serve(()=>{
  return new Response(
    "Direct Microsoft and Google calendar connections have been retired. Return to Famioo and use Work Calendar import.",
    {
      status:410,
      headers:{"Content-Type":"text/plain; charset=utf-8"},
    },
  )
})

import { createClient } from "npm:@supabase/supabase-js@2"

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type",
  "Access-Control-Allow-Methods":"POST,OPTIONS",
}

function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{...cors,"Content-Type":"application/json"},
  })
}

type RequestBody={
  household_id?:string
  image_data_url?:string
  reference_date?:string
}

function publishableKey(){
  const current=Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")
  if(current){
    try{
      const parsed=JSON.parse(current) as Record<string,string>
      if(parsed.default) return parsed.default
    }catch{
      // Legacy key fallback remains below.
    }
  }
  return Deno.env.get("SUPABASE_ANON_KEY")??""
}

function outputText(payload:any){
  if(typeof payload?.output_text==="string") return payload.output_text
  for(const item of payload?.output??[]){
    for(const part of item?.content??[]){
      if(part?.type==="output_text"&&typeof part.text==="string") return part.text
    }
  }
  return ""
}

const schema={
  type:"object",
  additionalProperties:false,
  required:["store_name","purchase_date","total_amount","currency","items","confidence"],
  properties:{
    store_name:{type:["string","null"],maxLength:160},
    purchase_date:{type:["string","null"],pattern:"^\\d{4}-\\d{2}-\\d{2}$"},
    total_amount:{type:["number","null"],minimum:0},
    currency:{type:"string",maxLength:3},
    confidence:{type:"number",minimum:0,maximum:1},
    items:{
      type:"array",
      maxItems:150,
      items:{
        type:"object",
        additionalProperties:false,
        required:[
          "product_name","normalized_name","quantity","unit",
          "unit_price","line_total","category","confidence"
        ],
        properties:{
          product_name:{type:"string",maxLength:220},
          normalized_name:{type:"string",maxLength:220},
          quantity:{type:["number","null"],minimum:0},
          unit:{type:["string","null"],maxLength:40},
          unit_price:{type:["number","null"],minimum:0},
          line_total:{type:["number","null"],minimum:0},
          category:{type:["string","null"],maxLength:80},
          confidence:{type:"number",minimum:0,maximum:1},
        },
      },
    },
  },
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors})
  if(req.method!=="POST") return json({error:"Method not allowed."},405)

  const authorization=req.headers.get("Authorization")??""
  if(!authorization.startsWith("Bearer ")) return json({error:"Authentication required."},401)

  let body:RequestBody
  try{ body=await req.json() }catch{ return json({error:"Invalid request."},400) }

  if(!body.household_id) return json({error:"Household is required."},400)
  if(!body.image_data_url||!/^data:image\/(?:png|jpeg|webp);base64,/i.test(body.image_data_url)){
    return json({error:"Choose a JPG, PNG or WebP receipt photo."},400)
  }
  if(body.image_data_url.length>12_000_000){
    return json({error:"The receipt image is too large for Assistant extraction."},413)
  }

  const supabaseUrl=Deno.env.get("SUPABASE_URL")??""
  const clientKey=publishableKey()
  if(!supabaseUrl||!clientKey) return json({error:"Server configuration is incomplete."},500)

  const userClient=createClient(supabaseUrl,clientKey,{
    global:{headers:{Authorization:authorization}},
    auth:{persistSession:false,autoRefreshToken:false},
  })

  const householdResult=await userClient
    .from("households")
    .select("id,timezone")
    .eq("id",body.household_id)
    .single()

  if(householdResult.error||!householdResult.data){
    return json({error:"This household is not accessible."},403)
  }

  const shoppingAccess=await userClient.rpc("household_module_enabled_v1",{
    p_household_id:body.household_id,
    p_module_code:"shopping",
  })
  if(shoppingAccess.error||shoppingAccess.data!==true){
    return json({error:"Shopping module access is required."},403)
  }

  const assistantAccess=await userClient.rpc("household_module_enabled_v1",{
    p_household_id:body.household_id,
    p_module_code:"assistant",
  })
  if(assistantAccess.error){
    console.error("Assistant entitlement check failed",assistantAccess.error)
    return json({error:"Famioo could not verify AI Assistant access."},503)
  }
  if(assistantAccess.data!==true){
    return json({
      error:"AI Assistant is required for receipt extraction.",
      code:"AI_ASSISTANT_REQUIRED",
    },403)
  }


  const allowanceResult=await userClient.rpc("assistant_usage_summary_v1",{
    p_household_id:body.household_id,
  })
  if(allowanceResult.error){
    console.error("Assistant allowance check failed",allowanceResult.error)
    return json({error:"Famioo could not verify the Assistant allowance."},503)
  }
  const allowance=Array.isArray(allowanceResult.data)?allowanceResult.data[0]:allowanceResult.data
  if(Number(allowance?.total_remaining??0)<=0){
    return json({
      error:"Your household has used all Assistant actions for this period.",
      code:"ASSISTANT_LIMIT_REACHED",
      cycle_end:allowance?.cycle_end??null,
    },429)
  }

  const apiKey=Deno.env.get("OPENAI_API_KEY")
  if(!apiKey) return json({error:"Receipt extraction is not configured on the server."},503)

  const referenceDate=/^\d{4}-\d{2}-\d{2}$/.test(body.reference_date??"")
    ?String(body.reference_date)
    :new Date().toISOString().slice(0,10)

  const prompt=[
    "Extract one retail shopping receipt into structured household-shopping data.",
    "Never invent products, prices, quantities, store names, totals or dates.",
    "Ignore payment card numbers, loyalty IDs, cashier IDs, transaction IDs and other sensitive/unneeded identifiers.",
    "store_name is the merchant/store name when clearly visible.",
    "purchase_date is YYYY-MM-DD. If the receipt date is absent or unreadable, return null rather than using today's date.",
    "total_amount is the final amount actually paid. Do not use subtotal when a final total is visible.",
    "currency must be a 3-letter ISO code. Use EUR only when the receipt clearly uses € or EUR; otherwise infer only from an explicit currency symbol/code.",
    "Each items[] row should represent a purchased product/service line, excluding totals, tax summary, deposits returned, payment methods and loyalty messages.",
    "normalized_name should be a short stable product name useful for comparing the same item across stores/months. Remove pack-size marketing noise only when safe, but keep meaningful variants such as brand/type.",
    "quantity and unit may be null when not shown.",
    "unit_price is price per purchased unit only when clearly shown or safely calculable from quantity and line total.",
    "line_total is the charged amount for that line after item-specific discounts when visible.",
    "category should be a practical grocery/household category such as Produce, Dairy, Meat, Bakery, Drinks, Household, Personal Care, Snacks, Frozen, Pantry, Pet, Other.",
    "confidence is 0..1.",
    "Reference date: "+referenceDate+".",
  ].join("\n")

  const model=Deno.env.get("OPENAI_RECEIPT_MODEL")
    ||Deno.env.get("OPENAI_CALENDAR_MODEL")
    ||"gpt-6-luna"

  let response:Response
  try{
    response=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{
        "Authorization":"Bearer "+apiKey,
        "Content-Type":"application/json",
      },
      body:JSON.stringify({
        model,
        store:false,
        input:[{
          role:"user",
          content:[
            {type:"input_text",text:prompt},
            {type:"input_image",image_url:body.image_data_url,detail:"high"},
          ],
        }],
        text:{
          format:{
            type:"json_schema",
            name:"shopping_receipt",
            strict:true,
            schema,
          },
        },
        max_output_tokens:7000,
      }),
    })
  }catch{
    return json({error:"Receipt extraction service could not be reached."},502)
  }

  const payload=await response.json().catch(()=>({}))
  if(!response.ok){
    const message=typeof payload?.error?.message==="string"
      ?payload.error.message
      :"Receipt extraction failed."
    return json({error:message.slice(0,500)},502)
  }

  const raw=outputText(payload)
  if(!raw) return json({error:"Assistant returned no receipt data."},502)

  let parsed:any
  try{ parsed=JSON.parse(raw) }catch{ return json({error:"Assistant returned unreadable receipt data."},502) }

  const items=(Array.isArray(parsed.items)?parsed.items:[])
    .slice(0,150)
    .filter((item)=>item&&String(item.product_name??"").trim())
    .map((item)=>({
      product_name:String(item.product_name).trim().slice(0,220),
      normalized_name:String(item.normalized_name||item.product_name).trim().slice(0,220),
      quantity:item.quantity==null?null:Math.max(0,Number(item.quantity)),
      unit:item.unit?String(item.unit).trim().slice(0,40):null,
      unit_price:item.unit_price==null?null:Math.max(0,Number(item.unit_price)),
      line_total:item.line_total==null?null:Math.max(0,Number(item.line_total)),
      category:item.category?String(item.category).trim().slice(0,80):null,
      confidence:Math.max(0,Math.min(1,Number(item.confidence??0))),
    }))


  const assistantUsage=payload?.usage??{}
  const consumeResult=await userClient.rpc("consume_assistant_action_v1",{
    p_household_id:body.household_id,
    p_action_type:"receipt_scan",
    p_model:model,
    p_input_tokens:Number.isFinite(Number(assistantUsage.input_tokens))?Math.max(0,Math.round(Number(assistantUsage.input_tokens))):null,
    p_output_tokens:Number.isFinite(Number(assistantUsage.output_tokens))?Math.max(0,Math.round(Number(assistantUsage.output_tokens))):null,
    p_total_tokens:Number.isFinite(Number(assistantUsage.total_tokens))?Math.max(0,Math.round(Number(assistantUsage.total_tokens))):null,
    p_metadata:{},
  })
  if(consumeResult.error){
    console.error("Assistant action accounting failed",consumeResult.error)
    return json({error:"The receipt was read, but Famioo could not record the Assistant action. Please try again."},503)
  }
  if(consumeResult.data?.ok!==true){
    return json({
      error:"Your household has used all Assistant actions for this period.",
      code:String(consumeResult.data?.code||"ASSISTANT_LIMIT_REACHED"),
      cycle_end:consumeResult.data?.cycle_end??null,
    },429)
  }

  return json({
    receipt:{
      store_name:parsed.store_name?String(parsed.store_name).trim().slice(0,160):null,
      purchase_date:parsed.purchase_date?String(parsed.purchase_date):null,
      total_amount:parsed.total_amount==null?null:Math.max(0,Number(parsed.total_amount)),
      currency:String(parsed.currency||"EUR").toUpperCase().slice(0,3),
      confidence:Math.max(0,Math.min(1,Number(parsed.confidence??0))),
      items,
    },
    model,
  })
})

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
}

const allowedHosts=[
  "chefkoch.de","www.chefkoch.de",
  "lecker.de","www.lecker.de",
  "essen-und-trinken.de","www.essen-und-trinken.de",
  "bbcgoodfood.com","www.bbcgoodfood.com",
  "allrecipes.com","www.allrecipes.com",
]

function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{...corsHeaders,"Content-Type":"application/json"},
  })
}

function cleanText(value:unknown){
  if(typeof value!=="string") return ""
  return value
    .replace(/<br\s*\/?>/gi,"\n")
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/\s+/g," ")
    .trim()
}

function durationMinutes(value:unknown){
  if(typeof value!=="string") return null
  const match=value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i)
  if(!match) return null
  return (Number(match[1]||0)*24*60)+(Number(match[2]||0)*60)+Number(match[3]||0)+Math.round(Number(match[4]||0)/60)
}

function numericYield(value:unknown){
  const raw=Array.isArray(value)?String(value[0]??""):String(value??"")
  const match=raw.match(/\d+/)
  return match?Number(match[0]):null
}

function typeIncludesRecipe(value:unknown){
  if(Array.isArray(value)) return value.some((item)=>String(item).toLowerCase()==="recipe")
  return String(value??"").toLowerCase()==="recipe"
}

function findRecipeNode(value:unknown):Record<string,unknown>|null{
  if(!value) return null
  if(Array.isArray(value)){
    for(const item of value){
      const found=findRecipeNode(item)
      if(found) return found
    }
    return null
  }
  if(typeof value!=="object") return null
  const object=value as Record<string,unknown>
  if(typeIncludesRecipe(object["@type"])) return object
  if(object["@graph"]){
    const found=findRecipeNode(object["@graph"])
    if(found) return found
  }
  for(const child of Object.values(object)){
    if(child && typeof child==="object"){
      const found=findRecipeNode(child)
      if(found) return found
    }
  }
  return null
}

function flattenInstructions(value:unknown):string[]{
  if(!value) return []
  if(typeof value==="string") return cleanText(value).split(/\n+/).map(cleanText).filter(Boolean)
  if(Array.isArray(value)) return value.flatMap(flattenInstructions)
  if(typeof value!=="object") return []
  const object=value as Record<string,unknown>
  const text=cleanText(object.text)
  const nested=flattenInstructions(object.itemListElement)
  if(text) return [text,...nested]
  return nested
}

function ingredientLines(value:unknown):string[]{
  if(!value) return []
  const source=Array.isArray(value)?value:[value]
  return source.map((entry)=>{
    if(typeof entry==="string") return cleanText(entry)
    if(!entry || typeof entry!=="object") return ""
    const object=entry as Record<string,unknown>
    const quantity=cleanText(object.value)
    const unit=cleanText(object.unitText || object.unitCode)
    const name=cleanText(object.name)
    return [quantity,unit,name].filter(Boolean).join(" ").trim()
  }).filter(Boolean)
}

function authorName(value:unknown){
  if(typeof value==="string") return cleanText(value)
  if(Array.isArray(value)) return value.map(authorName).filter(Boolean).join(", ")
  if(value && typeof value==="object") return cleanText((value as Record<string,unknown>).name)
  return ""
}

function imageUrl(value:unknown){
  if(typeof value==="string") return value
  if(Array.isArray(value)) return imageUrl(value[0])
  if(value && typeof value==="object"){
    const object=value as Record<string,unknown>
    return typeof object.url==="string" ? object.url : typeof object.contentUrl==="string" ? object.contentUrl : ""
  }
  return ""
}

function mealType(value:unknown){
  const text=(Array.isArray(value)?value.join(" "):String(value??"")).toLowerCase()
  if(/breakfast|frühstück/.test(text)) return "breakfast"
  if(/lunch|mittag/.test(text)) return "lunch"
  if(/snack|dessert|cake|kuchen|gebäck|baking|backen/.test(text)) return "snack"
  if(/dinner|main|hauptgericht|abend/.test(text)) return "dinner"
  return "dinner"
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders})
  if(req.method!=="POST") return json({error:"Method not allowed."},405)

  const supabaseUrl=Deno.env.get("SUPABASE_URL")
  const anonKey=Deno.env.get("SUPABASE_ANON_KEY")
  if(!supabaseUrl||!anonKey) return json({error:"Server configuration is incomplete."},500)

  const authorization=req.headers.get("Authorization")
  if(!authorization) return json({error:"Authentication required."},401)

  const userClient=createClient(supabaseUrl,anonKey,{
    global:{headers:{Authorization:authorization}},
    auth:{persistSession:false,autoRefreshToken:false},
  })
  const {data:{user},error:userError}=await userClient.auth.getUser()
  if(userError||!user) return json({error:"Authentication required."},401)

  let body:{household_id?:string;url?:string}
  try{ body=await req.json() } catch { return json({error:"Invalid request body."},400) }

  const householdId=body.household_id?.trim()
  const rawUrl=body.url?.trim()
  if(!householdId||!rawUrl) return json({error:"Household and recipe URL are required."},400)

  // Validate household access with the same authenticated client/RLS path used
  // by the Famioo web app. This prevents the Edge Function from disagreeing
  // with a household the signed-in user can already open in the app.
  const membership=await userClient
    .from("household_members")
    .select("role,status")
    .eq("household_id",householdId)
    .eq("user_id",user.id)
    .eq("status","active")
    .maybeSingle()

  if(membership.error||!membership.data) {
    return json({error:"You do not have access to this household."},403)
  }

  // Use the same entitlement RPC as the Famioo application. This avoids
  // a second, service-role-specific interpretation of household module access.
  const moduleAccess=await userClient.rpc("household_module_enabled_v1",{
    p_household_id:householdId,
    p_module_code:"meals",
  })

  if(moduleAccess.error) {
    console.error("recipe module entitlement check failed",moduleAccess.error)
    return json({error:"Famioo could not verify Meals & Recipes access. Please try again."},503)
  }

  if(moduleAccess.data!==true) return json({error:"Meals & Recipes is not enabled for this household."},403)

  let url:URL
  try{ url=new URL(rawUrl) } catch { return json({error:"Enter a valid recipe URL."},400) }
  if(url.protocol!=="https:") return json({error:"Recipe imports require an HTTPS link."},400)
  if(!allowedHosts.includes(url.hostname.toLowerCase())){
    return json({
      error:"This recipe website is not supported yet.",
      supported:["Chefkoch","LECKER","essen & trinken","BBC Good Food","Allrecipes"],
    },400)
  }

  let response:Response
  try{
    response=await fetch(url.toString(),{
      redirect:"follow",
      headers:{
        "User-Agent":"Famioo Recipe Importer/1.0",
        "Accept":"text/html,application/xhtml+xml",
        "Accept-Language":"de-DE,de;q=0.9,en;q=0.8",
      },
    })
  } catch {
    return json({error:"Famioo could not reach that recipe page."},400)
  }

  if(!response.ok) return json({error:"The recipe page returned HTTP "+response.status+"."},400)
  const contentType=response.headers.get("content-type")||""
  if(!contentType.includes("text/html")&&!contentType.includes("application/xhtml+xml")){
    return json({error:"That link is not an HTML recipe page."},400)
  }

  const html=await response.text()
  if(html.length>5_000_000) return json({error:"That recipe page is too large to import safely."},400)

  const scripts=[...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match)=>match[1]?.trim())
    .filter(Boolean)

  let recipe:Record<string,unknown>|null=null
  for(const script of scripts){
    try{
      const parsed=JSON.parse(script)
      recipe=findRecipeNode(parsed)
      if(recipe) break
    } catch {
      // Some publishers include malformed analytics JSON-LD. Ignore it.
    }
  }

  if(!recipe){
    return json({
      error:"No structured recipe data was found on this page. Famioo imports only recipe pages that publish Schema.org Recipe data.",
    },422)
  }

  const ingredients=ingredientLines(recipe.recipeIngredient || recipe.ingredients)
  const instructions=flattenInstructions(recipe.recipeInstructions || recipe.step)
  const prep=durationMinutes(recipe.prepTime)
  const total=durationMinutes(recipe.totalTime)
  const cook=durationMinutes(recipe.cookTime)

  return json({
    ok:true,
    recipe:{
      title:cleanText(recipe.name)||"Imported recipe",
      description:cleanText(recipe.description),
      meal_type:mealType(recipe.recipeCategory),
      prep_minutes:prep ?? (total!=null && cook!=null ? Math.max(0,total-cook) : total),
      servings:numericYield(recipe.recipeYield || recipe.yield),
      ingredients,
      instructions:instructions.join("\n\n"),
      source_url:response.url || url.toString(),
      source_site:new URL(response.url || url.toString()).hostname.replace(/^www\./,""),
      source_author:authorName(recipe.author),
      source_image_url:imageUrl(recipe.image),
    },
  })
})

import {
  Archive,
  CalendarDays,
  ChefHat,
  Clock3,
  ExternalLink,
  Globe2,
  Pencil,
  Plus,
  RotateCcw,
  ShoppingBag,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { DatePicker } from '../components/ui/DatePicker'
import { Select } from '../components/ui/Select'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type MealsTab='plan'|'recipes'|'archive'
type MealType='breakfast'|'lunch'|'dinner'|'snack'|'other'
type RecipeSource='own'|'imported'
type ShoppingMode='existing'|'new'

type Recipe={
  id:string
  title:string
  description:string|null
  meal_type:MealType
  prep_minutes:number|null
  servings:number|null
  instructions:string|null
  source_type:RecipeSource
  source_url:string|null
  source_site:string|null
  source_author:string|null
  source_image_url:string|null
  imported_at:string|null
  archived_at:string|null
  created_at:string
}

type Ingredient={
  id:string
  recipe_id:string
  item_text:string
  quantity:string|null
  sort_order:number
}

type MealPlanEntry={
  id:string
  recipe_id:string|null
  title:string
  meal_date:string
  meal_type:MealType
  notes:string|null
  linked_event_id:string|null
  created_at:string
}

type ShoppingList={
  id:string
  title:string
}

type ImportedRecipe={
  title:string
  description:string
  meal_type:MealType
  prep_minutes:number|null
  servings:number|null
  ingredients:string[]
  instructions:string
  source_url:string
  source_site:string
  source_author:string
  source_image_url:string
}

type ConfirmState=
  | { kind:'recipe';id:string;title:string }
  | { kind:'deleteRecipe';id:string;title:string }
  | { kind:'meal';id:string;title:string;linkedEventId:string|null }
  | null

const mealTypeOptions=[
  { value:'breakfast',label:'Breakfast' },
  { value:'lunch',label:'Lunch' },
  { value:'dinner',label:'Dinner' },
  { value:'snack',label:'Snack' },
  { value:'other',label:'Other' },
]

function todayKey(){
  const now=new Date()
  const y=now.getFullYear()
  const m=String(now.getMonth()+1).padStart(2,'0')
  const d=String(now.getDate()).padStart(2,'0')
  return y+'-'+m+'-'+d
}

function parseIngredients(value:string){
  return value
    .split('\n')
    .map((line)=>line.trim())
    .filter(Boolean)
    .map((line,index)=>{
      const pipe=line.indexOf('|')
      if(pipe<0) return { item_text:line,quantity:null,sort_order:index }
      const quantity=line.slice(0,pipe).trim()
      const item=line.slice(pipe+1).trim()
      return { item_text:item || quantity,quantity:item ? quantity || null : null,sort_order:index }
    })
}

function importedIngredientForEditor(line:string){
  const trimmed=line.trim()
  const match=trimmed.match(/^((?:(?:\d+(?:[.,]\d+)?)|(?:\d+\s*\/\s*\d+)|[¼½¾⅓⅔⅛⅜⅝⅞])(?:\s*(?:-|–)\s*(?:\d+(?:[.,]\d+)?))?\s*(?:kg|g|mg|l|ml|cl|dl|tsp|tbsp|tl|el|cup|cups|oz|lb|lbs|stück|stk\.?|prise[n]?|bund|dose[n]?|päckchen|packung|scheibe[n]?|zehe[n]?)?)\s+(.+)$/i)
  return match ? match[1].trim()+' | '+match[2].trim() : trimmed
}

function normalizeIngredient(value:string){
  return value.trim().toLocaleLowerCase().replace(/\s+/g,' ')
}

export function MealsPage(){
  const { household,modules }=useHousehold()
  const access=modules.find((module)=>module.code==='meals')
  const canWrite=Boolean(access?.can_write)
  const calendarWritable=Boolean(modules.find((module)=>module.code==='calendar')?.can_write)
  const shoppingWritable=Boolean(modules.find((module)=>module.code==='shopping')?.can_write)

  const [tab,setTab]=useState<MealsTab>('plan')
  const [recipes,setRecipes]=useState<Recipe[]>([])
  const [archivedRecipes,setArchivedRecipes]=useState<Recipe[]>([])
  const [ingredients,setIngredients]=useState<Ingredient[]>([])
  const [meals,setMeals]=useState<MealPlanEntry[]>([])
  const [shoppingLists,setShoppingLists]=useState<ShoppingList[]>([])
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [saving,setSaving]=useState(false)
  const [confirm,setConfirm]=useState<ConfirmState>(null)

  const [recipeOpen,setRecipeOpen]=useState(false)
  const [editingRecipeId,setEditingRecipeId]=useState<string|null>(null)
  const [recipeTitle,setRecipeTitle]=useState('')
  const [recipeDescription,setRecipeDescription]=useState('')
  const [recipeMealType,setRecipeMealType]=useState<MealType>('dinner')
  const [recipePrep,setRecipePrep]=useState('')
  const [recipeServings,setRecipeServings]=useState('')
  const [recipeIngredients,setRecipeIngredients]=useState('')
  const [recipeInstructions,setRecipeInstructions]=useState('')
  const [recipeSourceType,setRecipeSourceType]=useState<RecipeSource>('own')
  const [recipeSourceUrl,setRecipeSourceUrl]=useState('')
  const [recipeSourceSite,setRecipeSourceSite]=useState('')
  const [recipeSourceAuthor,setRecipeSourceAuthor]=useState('')
  const [recipeSourceImageUrl,setRecipeSourceImageUrl]=useState('')
  const [recipeImportedAt,setRecipeImportedAt]=useState<string|null>(null)

  const [importOpen,setImportOpen]=useState(false)
  const [importUrl,setImportUrl]=useState('')
  const [importBusy,setImportBusy]=useState(false)

  const [mealOpen,setMealOpen]=useState(false)
  const [editingMealId,setEditingMealId]=useState<string|null>(null)
  const [mealRecipeId,setMealRecipeId]=useState('')
  const [mealTitle,setMealTitle]=useState('')
  const [mealDate,setMealDate]=useState(todayKey())
  const [mealType,setMealType]=useState<MealType>('dinner')
  const [mealNotes,setMealNotes]=useState('')
  const [mealCalendar,setMealCalendar]=useState(true)
  const [editingMealEventId,setEditingMealEventId]=useState<string|null>(null)

  const [shoppingOpen,setShoppingOpen]=useState(false)
  const [shoppingRecipe,setShoppingRecipe]=useState<Recipe|null>(null)
  const [shoppingMode,setShoppingMode]=useState<ShoppingMode>('existing')
  const [shoppingListId,setShoppingListId]=useState('')
  const [shoppingNewTitle,setShoppingNewTitle]=useState('')
  const [shoppingSelected,setShoppingSelected]=useState<Set<string>>(new Set())
  const [shoppingDuplicates,setShoppingDuplicates]=useState<Set<string>>(new Set())
  const [shoppingBusy,setShoppingBusy]=useState(false)

  async function load(){
    setError('')
    const [recipeResult,archivedResult,ingredientResult,mealResult,shoppingResult]=await Promise.all([
      supabase
        .from('recipes')
        .select('id,title,description,meal_type,prep_minutes,servings,instructions,source_type,source_url,source_site,source_author,source_image_url,imported_at,archived_at,created_at')
        .eq('household_id',household.id)
        .is('archived_at',null)
        .order('title'),
      supabase
        .from('recipes')
        .select('id,title,description,meal_type,prep_minutes,servings,instructions,source_type,source_url,source_site,source_author,source_image_url,imported_at,archived_at,created_at')
        .eq('household_id',household.id)
        .not('archived_at','is',null)
        .order('archived_at',{ ascending:false }),
      supabase
        .from('recipe_ingredients')
        .select('id,recipe_id,item_text,quantity,sort_order')
        .eq('household_id',household.id)
        .order('sort_order'),
      supabase
        .from('meal_plan_entries')
        .select('id,recipe_id,title,meal_date,meal_type,notes,linked_event_id,created_at')
        .eq('household_id',household.id)
        .gte('meal_date',todayKey())
        .order('meal_date')
        .order('meal_type'),
      shoppingWritable
        ? supabase
            .from('shopping_lists')
            .select('id,title')
            .eq('household_id',household.id)
            .eq('status','active')
            .is('archived_at',null)
            .order('created_at',{ ascending:false })
        : Promise.resolve({ data:[],error:null }),
    ])

    if(recipeResult.error) setError(recipeResult.error.message)
    else setRecipes((recipeResult.data??[]) as Recipe[])

    if(archivedResult.error) setError((current)=>current||archivedResult.error.message)
    else setArchivedRecipes((archivedResult.data??[]) as Recipe[])

    if(ingredientResult.error) setError((current)=>current||ingredientResult.error.message)
    else setIngredients((ingredientResult.data??[]) as Ingredient[])

    if(mealResult.error) setError((current)=>current||mealResult.error.message)
    else setMeals((mealResult.data??[]) as MealPlanEntry[])

    if(shoppingResult.error) setError((current)=>current||shoppingResult.error.message)
    else setShoppingLists((shoppingResult.data??[]) as ShoppingList[])
  }

  useEffect(()=>{ void load() },[household.id,shoppingWritable])

  const ingredientsByRecipe=useMemo(()=>{
    const map=new Map<string,Ingredient[]>()
    for(const item of ingredients){
      map.set(item.recipe_id,[...(map.get(item.recipe_id)??[]),item])
    }
    return map
  },[ingredients])

  const recipeOptions=useMemo(()=>[
    { value:'',label:'No saved recipe' },
    ...recipes.map((recipe)=>({ value:recipe.id,label:recipe.title })),
  ],[recipes])

  const shoppingListOptions=useMemo(
    ()=>shoppingLists.map((list)=>({ value:list.id,label:list.title })),
    [shoppingLists],
  )

  const groupedMeals=useMemo(()=>{
    const map=new Map<string,MealPlanEntry[]>()
    for(const meal of meals){
      map.set(meal.meal_date,[...(map.get(meal.meal_date)??[]),meal])
    }
    return Array.from(map.entries()).sort(([a],[b])=>a.localeCompare(b))
  },[meals])

  function resetRecipe(){
    setEditingRecipeId(null)
    setRecipeTitle('')
    setRecipeDescription('')
    setRecipeMealType('dinner')
    setRecipePrep('')
    setRecipeServings('')
    setRecipeIngredients('')
    setRecipeInstructions('')
    setRecipeSourceType('own')
    setRecipeSourceUrl('')
    setRecipeSourceSite('')
    setRecipeSourceAuthor('')
    setRecipeSourceImageUrl('')
    setRecipeImportedAt(null)
  }

  function openRecipe(recipe?:Recipe){
    resetRecipe()
    if(recipe){
      setEditingRecipeId(recipe.id)
      setRecipeTitle(recipe.title)
      setRecipeDescription(recipe.description??'')
      setRecipeMealType(recipe.meal_type)
      setRecipePrep(recipe.prep_minutes==null?'':String(recipe.prep_minutes))
      setRecipeServings(recipe.servings==null?'':String(recipe.servings))
      setRecipeInstructions(recipe.instructions??'')
      setRecipeSourceType(recipe.source_type)
      setRecipeSourceUrl(recipe.source_url??'')
      setRecipeSourceSite(recipe.source_site??'')
      setRecipeSourceAuthor(recipe.source_author??'')
      setRecipeSourceImageUrl(recipe.source_image_url??'')
      setRecipeImportedAt(recipe.imported_at)
      setRecipeIngredients(
        (ingredientsByRecipe.get(recipe.id)??[])
          .map((item)=>item.quantity ? item.quantity+' | '+item.item_text : item.item_text)
          .join('\n'),
      )
    }
    setRecipeOpen(true)
  }

  async function saveRecipe(event:FormEvent){
    event.preventDefault()
    if(!canWrite || !recipeTitle.trim()) return
    setSaving(true)
    setError('')
    setMessage('')

    const payload={
      household_id:household.id,
      title:recipeTitle.trim(),
      description:recipeDescription.trim()||null,
      meal_type:recipeMealType,
      prep_minutes:recipePrep ? Number(recipePrep) : null,
      servings:recipeServings ? Number(recipeServings) : null,
      instructions:recipeInstructions.trim()||null,
      source_type:recipeSourceType,
      source_url:recipeSourceType==='imported' ? recipeSourceUrl || null : null,
      source_site:recipeSourceType==='imported' ? recipeSourceSite || null : null,
      source_author:recipeSourceType==='imported' ? recipeSourceAuthor || null : null,
      source_image_url:recipeSourceType==='imported' ? recipeSourceImageUrl || null : null,
      imported_at:recipeSourceType==='imported' ? recipeImportedAt ?? new Date().toISOString() : null,
      updated_at:new Date().toISOString(),
    }

    const result=editingRecipeId
      ? await supabase.from('recipes').update(payload).eq('id',editingRecipeId).eq('household_id',household.id).select('id').single()
      : await supabase.from('recipes').insert(payload).select('id').single()

    if(result.error){
      setSaving(false)
      setError(result.error.message)
      return
    }

    const recipeId=result.data.id
    if(editingRecipeId){
      const remove=await supabase.from('recipe_ingredients').delete().eq('recipe_id',recipeId).eq('household_id',household.id)
      if(remove.error){
        setSaving(false)
        setError(remove.error.message)
        return
      }
    }

    const parsed=parseIngredients(recipeIngredients)
    if(parsed.length){
      const ingredientResult=await supabase.from('recipe_ingredients').insert(parsed.map((item)=>({
        ...item,
        household_id:household.id,
        recipe_id:recipeId,
      })))
      if(ingredientResult.error){
        setSaving(false)
        setError(ingredientResult.error.message)
        return
      }
    }

    setSaving(false)
    setRecipeOpen(false)
    resetRecipe()
    setTab('recipes')
    setMessage(recipeSourceType==='imported' ? 'Imported recipe saved in your Recipe book.' : 'Recipe saved in your Recipe book.')
    await load()
  }

  async function importFromWebsite(event:FormEvent){
    event.preventDefault()
    if(!canWrite || !importUrl.trim()) return

    setImportBusy(true)
    setError('')
    setMessage('')

    const result=await supabase.functions.invoke('import-recipe-url',{
      body:{
        household_id:household.id,
        url:importUrl.trim(),
      },
    })

    setImportBusy(false)

    if(result.error || result.data?.error){
      let detail=result.data?.error || result.error?.message || 'Recipe import failed.'
      const context=(result.error as { context?:Response }|null)?.context
      if(context){
        try{
          const payload=await context.clone().json() as { error?:string }
          if(payload.error) detail=payload.error
        } catch {
          // Keep the normal function error.
        }
      }
      setError(detail)
      return
    }

    const imported=result.data?.recipe as ImportedRecipe|undefined
    if(!imported){
      setError('The recipe website did not return a recipe.')
      return
    }

    resetRecipe()
    setRecipeTitle(imported.title||'Imported recipe')
    setRecipeDescription(imported.description||'')
    setRecipeMealType(imported.meal_type||'dinner')
    setRecipePrep(imported.prep_minutes==null?'':String(imported.prep_minutes))
    setRecipeServings(imported.servings==null?'':String(imported.servings))
    setRecipeIngredients((imported.ingredients??[]).map(importedIngredientForEditor).join('\n'))
    setRecipeInstructions(imported.instructions||'')
    setRecipeSourceType('imported')
    setRecipeSourceUrl(imported.source_url||importUrl.trim())
    setRecipeSourceSite(imported.source_site||'')
    setRecipeSourceAuthor(imported.source_author||'')
    setRecipeSourceImageUrl(imported.source_image_url||'')
    setRecipeImportedAt(new Date().toISOString())
    setImportOpen(false)
    setImportUrl('')
    setRecipeOpen(true)
  }

  function resetMeal(){
    setEditingMealId(null)
    setMealRecipeId('')
    setMealTitle('')
    setMealDate(todayKey())
    setMealType('dinner')
    setMealNotes('')
    setMealCalendar(calendarWritable)
    setEditingMealEventId(null)
  }

  function openMeal(meal?:MealPlanEntry){
    resetMeal()
    if(meal){
      setEditingMealId(meal.id)
      setMealRecipeId(meal.recipe_id??'')
      setMealTitle(meal.title)
      setMealDate(meal.meal_date)
      setMealType(meal.meal_type)
      setMealNotes(meal.notes??'')
      setMealCalendar(Boolean(meal.linked_event_id))
      setEditingMealEventId(meal.linked_event_id)
    }
    setMealOpen(true)
  }

  function chooseRecipe(recipeId:string){
    setMealRecipeId(recipeId)
    const recipe=recipes.find((item)=>item.id===recipeId)
    if(!recipe) return
    setMealTitle(recipe.title)
    setMealType(recipe.meal_type)
  }

  async function saveMeal(event:FormEvent){
    event.preventDefault()
    if(!canWrite || !mealTitle.trim() || !mealDate) return
    setSaving(true)
    setError('')
    setMessage('')

    let linkedEventId=editingMealEventId

    if(mealCalendar && calendarWritable){
      const [calendarResult,categoryResult]=await Promise.all([
        supabase
          .from('calendars')
          .select('id,is_default')
          .eq('household_id',household.id)
          .eq('active',true)
          .order('is_default',{ ascending:false })
          .limit(1),
        supabase
          .from('event_categories')
          .select('id,name')
          .eq('household_id',household.id)
          .eq('active',true)
          .in('name',['Family','Other'])
          .order('sort_order')
          .limit(1),
      ])

      if(calendarResult.error || !calendarResult.data?.[0]){
        setSaving(false)
        setError(calendarResult.error?.message??'No active Calendar is available.')
        return
      }

      const eventResult=await supabase.rpc('save_event_v1',{
        p_event_id:linkedEventId,
        p_household_id:household.id,
        p_calendar_id:calendarResult.data[0].id,
        p_title:'Meal · '+mealTitle.trim(),
        p_description:mealNotes.trim()||null,
        p_all_day:true,
        p_start_at:null,
        p_end_at:null,
        p_start_date:mealDate,
        p_end_date:mealDate,
        p_timezone:household.timezone,
        p_location_text:null,
        p_category_id:categoryResult.data?.[0]?.id??null,
        p_visibility:'household',
        p_participants:[],
        p_rrule:null,
        p_reminders:[],
      })

      if(eventResult.error){
        setSaving(false)
        setError(eventResult.error.message)
        return
      }
      linkedEventId=eventResult.data as string
    } else if(!mealCalendar && linkedEventId){
      const deleteResult=await supabase.rpc('delete_event_v1',{
        p_event_id:linkedEventId,
        p_household_id:household.id,
      })
      if(deleteResult.error){
        setSaving(false)
        setError(deleteResult.error.message)
        return
      }
      linkedEventId=null
    }

    const payload={
      household_id:household.id,
      recipe_id:mealRecipeId||null,
      title:mealTitle.trim(),
      meal_date:mealDate,
      meal_type:mealType,
      notes:mealNotes.trim()||null,
      linked_event_id:linkedEventId,
      updated_at:new Date().toISOString(),
    }

    const result=editingMealId
      ? await supabase.from('meal_plan_entries').update(payload).eq('id',editingMealId).eq('household_id',household.id)
      : await supabase.from('meal_plan_entries').insert(payload)

    setSaving(false)
    if(result.error){
      setError(result.error.message)
      return
    }

    setMealOpen(false)
    resetMeal()
    setMessage('Meal saved.')
    await load()
  }

  async function loadShoppingDuplicates(listId:string,recipe:Recipe){
    const recipeItems=ingredientsByRecipe.get(recipe.id)??[]
    if(!listId){
      setShoppingDuplicates(new Set())
      setShoppingSelected(new Set(recipeItems.map((item)=>item.id)))
      return
    }

    const result=await supabase
      .from('shopping_items')
      .select('item_text')
      .eq('household_id',household.id)
      .eq('shopping_list_id',listId)

    if(result.error){
      setError(result.error.message)
      return
    }

    const existingNames=new Set((result.data??[]).map((row)=>normalizeIngredient(row.item_text)))
    const duplicateIds=new Set(recipeItems
      .filter((item)=>existingNames.has(normalizeIngredient(item.item_text)))
      .map((item)=>item.id))

    setShoppingDuplicates(duplicateIds)
    setShoppingSelected(new Set(recipeItems.filter((item)=>!duplicateIds.has(item.id)).map((item)=>item.id)))
  }

  function openShoppingExport(recipe:Recipe){
    const recipeItems=ingredientsByRecipe.get(recipe.id)??[]
    if(!recipeItems.length){
      setError('Add ingredients to this recipe first.')
      return
    }

    const firstList=shoppingLists[0]?.id??''
    setShoppingRecipe(recipe)
    setShoppingMode(firstList ? 'existing' : 'new')
    setShoppingListId(firstList)
    setShoppingNewTitle(recipe.title+' ingredients')
    setShoppingDuplicates(new Set())
    setShoppingSelected(new Set(recipeItems.map((item)=>item.id)))
    setShoppingOpen(true)

    if(firstList) void loadShoppingDuplicates(firstList,recipe)
  }

  async function exportToShopping(){
    if(!shoppingWritable || !shoppingRecipe || shoppingBusy) return

    const recipeItems=(ingredientsByRecipe.get(shoppingRecipe.id)??[])
      .filter((item)=>shoppingSelected.has(item.id))

    if(!recipeItems.length){
      setError('Choose at least one ingredient to export.')
      return
    }

    if(shoppingMode==='existing' && !shoppingListId){
      setError('Choose a Shopping list.')
      return
    }

    if(shoppingMode==='new' && !shoppingNewTitle.trim()){
      setError('Enter a name for the new Shopping list.')
      return
    }

    setShoppingBusy(true)
    setError('')
    setMessage('')

    let targetListId=shoppingListId
    let targetTitle=shoppingLists.find((list)=>list.id===shoppingListId)?.title??'Shopping list'

    if(shoppingMode==='new'){
      const listResult=await supabase
        .from('shopping_lists')
        .insert({
          household_id:household.id,
          title:shoppingNewTitle.trim(),
          status:'active',
        })
        .select('id,title')
        .single()

      if(listResult.error){
        setShoppingBusy(false)
        setError(listResult.error.message)
        return
      }

      targetListId=listResult.data.id
      targetTitle=listResult.data.title
    }

    const currentResult=await supabase
      .from('shopping_items')
      .select('sort_order')
      .eq('household_id',household.id)
      .eq('shopping_list_id',targetListId)
      .order('sort_order',{ ascending:false })
      .limit(1)

    const firstSort=(currentResult.data?.[0]?.sort_order??-1)+1

    const itemResult=await supabase.from('shopping_items').insert(recipeItems.map((item,index)=>({
      household_id:household.id,
      shopping_list_id:targetListId,
      item_text:item.item_text,
      quantity:item.quantity,
      sort_order:firstSort+index,
    })))

    setShoppingBusy(false)

    if(itemResult.error){
      setError(itemResult.error.message)
      return
    }

    setShoppingOpen(false)
    setShoppingRecipe(null)
    setMessage(recipeItems.length+' ingredient'+(recipeItems.length===1?'':'s')+' added to '+targetTitle+'.')
    await load()
  }

  async function restoreRecipe(recipe:Recipe){
    const result=await supabase
      .from('recipes')
      .update({ archived_at:null,updated_at:new Date().toISOString() })
      .eq('id',recipe.id)
      .eq('household_id',household.id)

    if(result.error){
      setError(result.error.message)
      return
    }

    setMessage(recipe.title+' restored to your Recipe book.')
    await load()
  }

  async function confirmDelete(){
    if(!confirm || !canWrite) return
    setSaving(true)
    setError('')

    if(confirm.kind==='recipe'){
      const result=await supabase
        .from('recipes')
        .update({ archived_at:new Date().toISOString(),updated_at:new Date().toISOString() })
        .eq('id',confirm.id)
        .eq('household_id',household.id)
      if(result.error){
        setSaving(false)
        setError(result.error.message)
        return
      }
    } else if(confirm.kind==='deleteRecipe'){
      const result=await supabase
        .from('recipes')
        .delete()
        .eq('id',confirm.id)
        .eq('household_id',household.id)
      if(result.error){
        setSaving(false)
        setError(result.error.message)
        return
      }
    } else {
      if(confirm.linkedEventId){
        const eventResult=await supabase.rpc('delete_event_v1',{
          p_event_id:confirm.linkedEventId,
          p_household_id:household.id,
        })
        if(eventResult.error){
          setSaving(false)
          setError(eventResult.error.message)
          return
        }
      }
      const result=await supabase
        .from('meal_plan_entries')
        .delete()
        .eq('id',confirm.id)
        .eq('household_id',household.id)
      if(result.error){
        setSaving(false)
        setError(result.error.message)
        return
      }
    }

    setSaving(false)
    setConfirm(null)
    await load()
  }

  function recipeCard(recipe:Recipe,archived=false){
    const recipeItems=ingredientsByRecipe.get(recipe.id)??[]

    return (
      <article className="recipe-card list-card" key={recipe.id}>
        <header>
          <div>
            <span className="eyebrow">{recipe.meal_type.toUpperCase()}</span>
            <h2>{recipe.title}</h2>
          </div>
          {canWrite && (
            <div className="recipe-actions">
              {!archived && <button type="button" className="icon-button compact-icon" onClick={()=>openRecipe(recipe)} aria-label={'Edit '+recipe.title}><Pencil size={14}/></button>}
              {archived ? (
                <>
                  <button type="button" className="icon-button compact-icon" onClick={()=>void restoreRecipe(recipe)} aria-label={'Restore '+recipe.title}><RotateCcw size={14}/></button>
                  <button type="button" className="icon-button compact-icon danger-icon-button" onClick={()=>setConfirm({ kind:'deleteRecipe',id:recipe.id,title:recipe.title })} aria-label={'Permanently delete '+recipe.title}><Trash2 size={14}/></button>
                </>
              ) : (
                <button type="button" className="icon-button compact-icon danger-icon-button" onClick={()=>setConfirm({ kind:'recipe',id:recipe.id,title:recipe.title })} aria-label={'Archive '+recipe.title}><Archive size={14}/></button>
              )}
            </div>
          )}
        </header>

        <div className="recipe-source-row">
          <span className={recipe.source_type==='imported'?'recipe-source imported':'recipe-source'}>
            {recipe.source_type==='imported' ? <Globe2 size={12}/> : <ChefHat size={12}/>}
            {recipe.source_type==='imported' ? 'Imported · '+(recipe.source_site||'website') : 'Own recipe'}
          </span>
          {recipe.source_url && (
            <a href={recipe.source_url} target="_blank" rel="noreferrer">
              Source<ExternalLink size={11}/>
            </a>
          )}
        </div>

        {recipe.description && <p>{recipe.description}</p>}

        <div className="recipe-meta">
          {recipe.prep_minutes!=null && <span><Clock3 size={13}/>{recipe.prep_minutes} min</span>}
          {recipe.servings!=null && <span><Users size={13}/>{recipe.servings} servings</span>}
          <span>{recipeItems.length} ingredients</span>
          {recipe.source_author && <span>By {recipe.source_author}</span>}
        </div>

        {recipeItems.length>0 && (
          <details className="recipe-ingredients">
            <summary>Ingredients</summary>
            <div>
              {recipeItems.map((item)=>(
                <span key={item.id}><b>{item.quantity||'•'}</b>{item.item_text}</span>
              ))}
            </div>
          </details>
        )}

        {recipe.instructions && (
          <details className="recipe-ingredients recipe-instructions">
            <summary>Preparation</summary>
            <div><p>{recipe.instructions}</p></div>
          </details>
        )}

        {!archived && (
          <footer>
            {shoppingWritable && (
              <button type="button" className="secondary-button compact" onClick={()=>openShoppingExport(recipe)}>
                <ShoppingBag size={14}/>Ingredients to Shopping
              </button>
            )}
            {canWrite && (
              <button type="button" className="primary-button compact" onClick={()=>{
                resetMeal()
                setMealRecipeId(recipe.id)
                setMealTitle(recipe.title)
                setMealType(recipe.meal_type)
                setMealOpen(true)
              }}>
                <CalendarDays size={14}/>Use as meal
              </button>
            )}
          </footer>
        )}
      </article>
    )
  }

  return (
    <div className="page meals-page">
      <div className="page-heading-row">
        <div>
          <div className="page-label">MEALS & RECIPES</div>
          <h1>Meals & Recipes</h1>
          <p className="page-subtitle">Keep your family recipe book, import supported web recipes, plan meals and send only the ingredients you need to Shopping.</p>
        </div>
        {canWrite && (
          <div className="meals-heading-actions">
            <button type="button" className="secondary-button compact" onClick={()=>openRecipe()}><Plus size={14}/>Own recipe</button>
            <button type="button" className="secondary-button compact" onClick={()=>{setImportUrl('');setError('');setImportOpen(true)}}><Globe2 size={14}/>Import website</button>
            <button type="button" className="primary-button compact" onClick={()=>openMeal()}><Plus size={14}/>Plan meal</button>
          </div>
        )}
      </div>

      <nav className="projects-tabs meals-tabs" aria-label="Meals and Recipes sections">
        <button type="button" className={tab==='plan'?'active':''} onClick={()=>setTab('plan')}>Meal plan</button>
        <button type="button" className={tab==='recipes'?'active':''} onClick={()=>setTab('recipes')}>Recipe book <span>{recipes.length}</span></button>
        <button type="button" className={tab==='archive'?'active':''} onClick={()=>setTab('archive')}>Archive <span>{archivedRecipes.length}</span></button>
      </nav>

      {!access?.enabled && <div className="module-access-note">Meals & Recipes is not enabled for this household.</div>}
      {access?.enabled && !canWrite && <div className="module-access-note">Read-only access</div>}
      {error && <div className="notice error">{error}</div>}
      {message && <div className="notice success">{message}</div>}

      {tab==='plan' && (
        <section className="meal-plan-list">
          {groupedMeals.length ? groupedMeals.map(([date,rows])=>(
            <article className="meal-day-card list-card" key={date}>
              <header>
                <div>
                  <span className="eyebrow">{new Date(date+'T12:00:00').toLocaleDateString(undefined,{ weekday:'long' }).toUpperCase()}</span>
                  <h2>{new Date(date+'T12:00:00').toLocaleDateString(undefined,{ day:'numeric',month:'long' })}</h2>
                </div>
                <span>{rows.length} meal{rows.length===1?'':'s'}</span>
              </header>
              <div className="meal-day-items">
                {rows.map((meal)=>(
                  <div className="meal-plan-row" key={meal.id}>
                    <span className="meal-type-chip">{meal.meal_type}</span>
                    <div>
                      <strong>{meal.title}</strong>
                      <small>{meal.notes||'No notes'}{meal.linked_event_id?' · Calendar':''}{meal.recipe_id?' · Recipe book':''}</small>
                    </div>
                    {canWrite && (
                      <div className="meal-row-actions">
                        <button type="button" className="icon-button compact-icon" onClick={()=>openMeal(meal)} aria-label={'Edit '+meal.title}><Pencil size={14}/></button>
                        <button type="button" className="icon-button compact-icon danger-icon-button" onClick={()=>setConfirm({ kind:'meal',id:meal.id,title:meal.title,linkedEventId:meal.linked_event_id })} aria-label={'Delete '+meal.title}><Trash2 size={14}/></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </article>
          )) : (
            <div className="list-card empty-state">
              <ChefHat size={27}/>
              <span className="empty-state-title">No meals planned yet.</span>
              <span>Use any saved recipe as a meal or create a meal without a recipe.</span>
            </div>
          )}
        </section>
      )}

      {tab==='recipes' && (
        <section className="recipe-grid">
          {recipes.length ? recipes.map((recipe)=>recipeCard(recipe)) : (
            <div className="list-card empty-state">
              <ChefHat size={27}/>
              <span className="empty-state-title">Your Recipe book is empty.</span>
              <span>Create your own recipe or import one from a supported recipe website.</span>
            </div>
          )}
        </section>
      )}

      {tab==='archive' && (
        <section className="recipe-grid recipe-archive-grid">
          {archivedRecipes.length ? archivedRecipes.map((recipe)=>recipeCard(recipe,true)) : (
            <div className="list-card empty-state">
              <Archive size={27}/>
              <span className="empty-state-title">No archived recipes.</span>
              <span>Recipes you archive from the Recipe book will stay here until restored or permanently deleted.</span>
            </div>
          )}
        </section>
      )}

      {recipeOpen && canWrite && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event)=>{
          if(event.currentTarget===event.target && !saving){ setRecipeOpen(false);resetRecipe() }
        }}>
          <form className="modal-card meals-composer" onSubmit={saveRecipe}>
            <header>
              <div>
                <span className="eyebrow">{recipeSourceType==='imported'?'IMPORTED RECIPE':editingRecipeId?'EDIT RECIPE':'NEW RECIPE'}</span>
                <h2>{editingRecipeId?'Edit recipe':recipeSourceType==='imported'?'Review imported recipe':'Create your own recipe'}</h2>
              </div>
              <button type="button" className="icon-button" onClick={()=>{setRecipeOpen(false);resetRecipe()}} disabled={saving} aria-label="Close recipe form"><X size={18}/></button>
            </header>

            {recipeSourceType==='imported' && (
              <div className="recipe-import-source">
                <Globe2 size={16}/>
                <span>
                  <strong>{recipeSourceSite||'Imported website'}</strong>
                  <small>Review and edit anything before saving it to your Famioo Recipe book.</small>
                </span>
                {recipeSourceUrl && <a href={recipeSourceUrl} target="_blank" rel="noreferrer">Open source<ExternalLink size={12}/></a>}
              </div>
            )}

            <div className="composer-grid-two aligned-field-row">
              <label>Recipe name<input value={recipeTitle} onChange={(event)=>setRecipeTitle(event.target.value)} required autoFocus/></label>
              <label>Meal type<Select value={recipeMealType} onChange={(value)=>setRecipeMealType(value as MealType)} options={mealTypeOptions} ariaLabel="Choose meal type"/></label>
            </div>

            <label>Description<input value={recipeDescription} onChange={(event)=>setRecipeDescription(event.target.value)} placeholder="Optional short description"/></label>

            <div className="composer-grid-two aligned-field-row">
              <label>Prep time (minutes)<input type="number" min="0" max="1440" value={recipePrep} onChange={(event)=>setRecipePrep(event.target.value)} placeholder="30"/></label>
              <label>Servings<input type="number" min="1" max="100" value={recipeServings} onChange={(event)=>setRecipeServings(event.target.value)} placeholder="4"/></label>
            </div>

            <label>Ingredients
              <textarea value={recipeIngredients} onChange={(event)=>setRecipeIngredients(event.target.value)} rows={7} placeholder={'One ingredient per line\n500 g | Pasta\n2 | Tomatoes\nOlive oil'}/>
              <small className="field-hint">Use “quantity | ingredient” when you want a separate quantity. Imported ingredients can be corrected here before saving.</small>
            </label>

            <label>Instructions<textarea value={recipeInstructions} onChange={(event)=>setRecipeInstructions(event.target.value)} rows={7} placeholder="Preparation steps"/></label>

            {error && <div className="form-message error">{error}</div>}
            <div className="composer-footer-right">
              <button className="primary-button compact" disabled={saving}>
                {saving?'Saving…':editingRecipeId?'Save changes':'Save to Recipe book'}
              </button>
            </div>
          </form>
        </div>
      )}

      {importOpen && canWrite && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event)=>{
          if(event.currentTarget===event.target && !importBusy) setImportOpen(false)
        }}>
          <form className="modal-card recipe-import-composer" onSubmit={importFromWebsite}>
            <header>
              <div><span className="eyebrow">IMPORT FROM WEBSITE</span><h2>Bring a recipe into Famioo</h2></div>
              <button type="button" className="icon-button" onClick={()=>setImportOpen(false)} disabled={importBusy} aria-label="Close import"><X size={18}/></button>
            </header>

            <p className="recipe-import-copy">Paste a recipe-page link. Famioo reads the page's structured Recipe data, fills the recipe editor, and lets you review everything before saving.</p>

            <label>Recipe URL
              <input type="url" value={importUrl} onChange={(event)=>setImportUrl(event.target.value)} placeholder="https://www.chefkoch.de/rezepte/…" required autoFocus/>
            </label>

            <div className="recipe-supported-sites">
              <span>Supported now · open a site to find a recipe</span>
              <a href="https://www.chefkoch.de/rs/s0/Rezepte.html" target="_blank" rel="noreferrer">Chefkoch<ExternalLink size={12}/></a>
              <a href="https://www.lecker.de/rezepte" target="_blank" rel="noreferrer">LECKER<ExternalLink size={12}/></a>
              <a href="https://www.essen-und-trinken.de/rezepte" target="_blank" rel="noreferrer">essen & trinken<ExternalLink size={12}/></a>
              <a href="https://www.bbcgoodfood.com/recipes" target="_blank" rel="noreferrer">BBC Good Food<ExternalLink size={12}/></a>
              <a href="https://www.allrecipes.com/recipes/" target="_blank" rel="noreferrer">Allrecipes<ExternalLink size={12}/></a>
            </div>

            <small className="field-hint">Famioo does not bypass logins or paywalls. The original source link is kept with every imported recipe.</small>
            {error && <div className="form-message error">{error}</div>}

            <div className="composer-footer-right">
              <button className="primary-button compact" disabled={importBusy || !importUrl.trim()}>
                {importBusy?'Reading recipe…':'Import & review'}
              </button>
            </div>
          </form>
        </div>
      )}

      {mealOpen && canWrite && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event)=>{
          if(event.currentTarget===event.target && !saving){ setMealOpen(false);resetMeal() }
        }}>
          <form className="modal-card meals-composer" onSubmit={saveMeal}>
            <header>
              <div><span className="eyebrow">{editingMealId?'EDIT MEAL':'PLAN MEAL'}</span><h2>{editingMealId?'Edit planned meal':'Plan a meal'}</h2></div>
              <button type="button" className="icon-button" onClick={()=>{setMealOpen(false);resetMeal()}} disabled={saving} aria-label="Close meal form"><X size={18}/></button>
            </header>

            <label>Recipe from Recipe book<Select value={mealRecipeId} onChange={chooseRecipe} options={recipeOptions} ariaLabel="Choose saved recipe"/></label>

            <div className="composer-grid-two aligned-field-row">
              <label>Meal name<input value={mealTitle} onChange={(event)=>setMealTitle(event.target.value)} required/></label>
              <label>Meal type<Select value={mealType} onChange={(value)=>setMealType(value as MealType)} options={mealTypeOptions} ariaLabel="Choose meal type"/></label>
            </div>

            <label>Date<DatePicker value={mealDate} onChange={setMealDate} min={todayKey()} format={household.date_format} ariaLabel="Choose meal date"/></label>
            <label>Notes<textarea value={mealNotes} onChange={(event)=>setMealNotes(event.target.value)} rows={3} placeholder="Optional notes"/></label>

            {calendarWritable && (
              <label className="composer-option">
                <input type="checkbox" checked={mealCalendar} onChange={(event)=>setMealCalendar(event.target.checked)}/>
                <span><span>Add to Calendar</span><small>Creates one all-day meal event on the selected date.</small></span>
              </label>
            )}

            {error && <div className="form-message error">{error}</div>}
            <div className="composer-footer-right"><button className="primary-button compact" disabled={saving}>{saving?'Saving…':editingMealId?'Save changes':'Plan meal'}</button></div>
          </form>
        </div>
      )}

      {shoppingOpen && shoppingRecipe && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event)=>{
          if(event.currentTarget===event.target && !shoppingBusy){setShoppingOpen(false);setShoppingRecipe(null)}
        }}>
          <section className="modal-card recipe-shopping-composer">
            <header>
              <div><span className="eyebrow">SEND TO SHOPPING</span><h2>{shoppingRecipe.title}</h2></div>
              <button type="button" className="icon-button" onClick={()=>{setShoppingOpen(false);setShoppingRecipe(null)}} disabled={shoppingBusy} aria-label="Close Shopping export"><X size={18}/></button>
            </header>

            <div className="shopping-export-mode">
              <button
                type="button"
                className={shoppingMode==='existing'?'active':''}
                disabled={!shoppingLists.length}
                onClick={()=>{
                  setShoppingMode('existing')
                  const id=shoppingListId||shoppingLists[0]?.id||''
                  setShoppingListId(id)
                  if(id) void loadShoppingDuplicates(id,shoppingRecipe)
                }}
              >
                Existing Shopping list
              </button>
              <button type="button" className={shoppingMode==='new'?'active':''} onClick={()=>{
                setShoppingMode('new')
                setShoppingDuplicates(new Set())
                setShoppingSelected(new Set((ingredientsByRecipe.get(shoppingRecipe.id)??[]).map((item)=>item.id)))
              }}>
                New Shopping list
              </button>
            </div>

            {shoppingMode==='existing' ? (
              <label>Choose list
                <Select
                  value={shoppingListId}
                  onChange={(value)=>{
                    setShoppingListId(value)
                    void loadShoppingDuplicates(value,shoppingRecipe)
                  }}
                  options={shoppingListOptions}
                  placeholder="Choose Shopping list…"
                  ariaLabel="Choose Shopping list"
                />
              </label>
            ) : (
              <label>New list name<input value={shoppingNewTitle} onChange={(event)=>setShoppingNewTitle(event.target.value)} placeholder="e.g. Lidl"/></label>
            )}

            <div className="shopping-export-ingredients">
              <header><strong>Ingredients</strong><small>Uncheck anything you do not need.</small></header>
              {(ingredientsByRecipe.get(shoppingRecipe.id)??[]).map((item)=>(
                <label key={item.id}>
                  <input
                    type="checkbox"
                    checked={shoppingSelected.has(item.id)}
                    onChange={(event)=>setShoppingSelected((current)=>{
                      const next=new Set(current)
                      if(event.target.checked) next.add(item.id)
                      else next.delete(item.id)
                      return next
                    })}
                  />
                  <span>
                    <strong>{item.quantity ? item.quantity+' · ' : ''}{item.item_text}</strong>
                    {shoppingDuplicates.has(item.id) && <small>Already in selected list · left unchecked</small>}
                  </span>
                </label>
              ))}
            </div>

            <div className="recipe-shopping-footer">
              <span>{shoppingSelected.size} selected</span>
              <button
                type="button"
                className="primary-button compact"
                disabled={shoppingBusy || shoppingSelected.size===0 || (shoppingMode==='existing'&&!shoppingListId) || (shoppingMode==='new'&&!shoppingNewTitle.trim())}
                onClick={()=>void exportToShopping()}
              >
                <ShoppingBag size={14}/>{shoppingBusy?'Adding…':'Add ingredients'}
              </button>
            </div>
          </section>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        title={
          confirm?.kind==='recipe' ? 'Archive recipe?'
            : confirm?.kind==='deleteRecipe' ? 'Permanently delete recipe?'
              : 'Remove planned meal?'
        }
        message={
          confirm?.kind==='recipe'
            ? 'The recipe moves to the Recipe archive. Existing planned meals keep their name and date.'
            : confirm?.kind==='deleteRecipe'
              ? 'This recipe and its ingredient list will be permanently removed. Existing planned meals remain as historical meal entries.'
              : 'This planned meal will be removed'+(confirm?.kind==='meal' && confirm.linkedEventId?' together with its linked Calendar entry.':'.')
        }
        confirmLabel={confirm?.kind==='recipe'?'Archive':confirm?.kind==='deleteRecipe'?'Delete permanently':'Remove'}
        danger
        busy={saving}
        onCancel={()=>setConfirm(null)}
        onConfirm={()=>void confirmDelete()}
      />
    </div>
  )
}

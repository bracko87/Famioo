import {
  CalendarDays,
  ChefHat,
  Clock3,
  Pencil,
  Plus,
  ShoppingBag,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { DatePicker } from '../components/ui/DatePicker'
import { Select } from '../components/ui/Select'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type MealsTab='plan'|'recipes'
type MealType='breakfast'|'lunch'|'dinner'|'snack'|'other'

type Recipe={
  id:string
  title:string
  description:string|null
  meal_type:MealType
  prep_minutes:number|null
  servings:number|null
  instructions:string|null
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

type ConfirmState=
  | { kind:'recipe';id:string;title:string }
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

export function MealsPage(){
  const { household,modules }=useHousehold()
  const navigate=useNavigate()
  const access=modules.find((module)=>module.code==='meals')
  const canWrite=Boolean(access?.can_write)
  const calendarWritable=Boolean(modules.find((module)=>module.code==='calendar')?.can_write)
  const shoppingWritable=Boolean(modules.find((module)=>module.code==='shopping')?.can_write)

  const [tab,setTab]=useState<MealsTab>('plan')
  const [recipes,setRecipes]=useState<Recipe[]>([])
  const [ingredients,setIngredients]=useState<Ingredient[]>([])
  const [meals,setMeals]=useState<MealPlanEntry[]>([])
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

  const [mealOpen,setMealOpen]=useState(false)
  const [editingMealId,setEditingMealId]=useState<string|null>(null)
  const [mealRecipeId,setMealRecipeId]=useState('')
  const [mealTitle,setMealTitle]=useState('')
  const [mealDate,setMealDate]=useState(todayKey())
  const [mealType,setMealType]=useState<MealType>('dinner')
  const [mealNotes,setMealNotes]=useState('')
  const [mealCalendar,setMealCalendar]=useState(true)
  const [editingMealEventId,setEditingMealEventId]=useState<string|null>(null)

  async function load(){
    setError('')
    const [recipeResult,ingredientResult,mealResult]=await Promise.all([
      supabase
        .from('recipes')
        .select('id,title,description,meal_type,prep_minutes,servings,instructions,created_at')
        .eq('household_id',household.id)
        .is('archived_at',null)
        .order('title'),
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
    ])

    if(recipeResult.error) setError(recipeResult.error.message)
    else setRecipes((recipeResult.data??[]) as Recipe[])

    if(ingredientResult.error) setError((current)=>current||ingredientResult.error.message)
    else setIngredients((ingredientResult.data??[]) as Ingredient[])

    if(mealResult.error) setError((current)=>current||mealResult.error.message)
    else setMeals((mealResult.data??[]) as MealPlanEntry[])
  }

  useEffect(()=>{ void load() },[household.id])

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
    await load()
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
    await load()
  }

  async function sendToShopping(recipe:Recipe){
    if(!shoppingWritable) return
    setError('')
    setMessage('')
    const recipeItems=ingredientsByRecipe.get(recipe.id)??[]
    if(!recipeItems.length){
      setError('Add ingredients to this recipe first.')
      return
    }

    const listResult=await supabase
      .from('shopping_lists')
      .insert({
        household_id:household.id,
        title:recipe.title+' ingredients',
        status:'active',
      })
      .select('id')
      .single()

    if(listResult.error){
      setError(listResult.error.message)
      return
    }

    const itemResult=await supabase.from('shopping_items').insert(recipeItems.map((item,index)=>({
      household_id:household.id,
      shopping_list_id:listResult.data.id,
      item_text:item.item_text,
      quantity:item.quantity,
      sort_order:index,
    })))

    if(itemResult.error){
      setError(itemResult.error.message)
      return
    }

    navigate('/app/shopping')
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

  return (
    <div className="page meals-page">
      <div className="page-heading-row">
        <div>
          <div className="page-label">MEALS & RECIPES</div>
          <h1>Meals & Recipes</h1>
          <p className="page-subtitle">Save family recipes, plan meals, connect them to Calendar and move ingredients straight into Shopping.</p>
        </div>
        {canWrite && (
          <div className="meals-heading-actions">
            <button type="button" className="secondary-button compact" onClick={()=>openRecipe()}><Plus size={14}/>Recipe</button>
            <button type="button" className="primary-button compact" onClick={()=>openMeal()}><Plus size={14}/>Plan meal</button>
          </div>
        )}
      </div>

      <nav className="projects-tabs meals-tabs" aria-label="Meals and Recipes sections">
        <button type="button" className={tab==='plan'?'active':''} onClick={()=>setTab('plan')}>Meal plan</button>
        <button type="button" className={tab==='recipes'?'active':''} onClick={()=>setTab('recipes')}>Recipes</button>
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
                      <small>{meal.notes||'No notes'}{meal.linked_event_id?' · Calendar':''}</small>
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
              <span>Plan the first family meal and optionally add it to Calendar.</span>
            </div>
          )}
        </section>
      )}

      {tab==='recipes' && (
        <section className="recipe-grid">
          {recipes.length ? recipes.map((recipe)=>{
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
                      <button type="button" className="icon-button compact-icon" onClick={()=>openRecipe(recipe)} aria-label={'Edit '+recipe.title}><Pencil size={14}/></button>
                      <button type="button" className="icon-button compact-icon danger-icon-button" onClick={()=>setConfirm({ kind:'recipe',id:recipe.id,title:recipe.title })} aria-label={'Delete '+recipe.title}><Trash2 size={14}/></button>
                    </div>
                  )}
                </header>

                {recipe.description && <p>{recipe.description}</p>}

                <div className="recipe-meta">
                  {recipe.prep_minutes!=null && <span><Clock3 size={13}/>{recipe.prep_minutes} min</span>}
                  {recipe.servings!=null && <span><Users size={13}/>{recipe.servings} servings</span>}
                  <span>{recipeItems.length} ingredients</span>
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

                <footer>
                  {shoppingWritable && (
                    <button type="button" className="secondary-button compact" onClick={()=>void sendToShopping(recipe)}>
                      <ShoppingBag size={14}/>Send to Shopping
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
                      <CalendarDays size={14}/>Plan meal
                    </button>
                  )}
                </footer>
              </article>
            )
          }) : (
            <div className="list-card empty-state">
              <ChefHat size={27}/>
              <span className="empty-state-title">No recipes saved yet.</span>
              <span>Add a recipe with ingredients, instructions and serving information.</span>
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
              <div><span className="eyebrow">{editingRecipeId?'EDIT RECIPE':'NEW RECIPE'}</span><h2>{editingRecipeId?'Edit recipe':'Add recipe'}</h2></div>
              <button type="button" className="icon-button" onClick={()=>{setRecipeOpen(false);resetRecipe()}} disabled={saving} aria-label="Close recipe form"><X size={18}/></button>
            </header>

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
              <textarea value={recipeIngredients} onChange={(event)=>setRecipeIngredients(event.target.value)} rows={6} placeholder={'One ingredient per line\n500 g | Pasta\n2 | Tomatoes\nOlive oil'}/>
              <small className="field-hint">Use “quantity | ingredient” when you want a quantity.</small>
            </label>

            <label>Instructions<textarea value={recipeInstructions} onChange={(event)=>setRecipeInstructions(event.target.value)} rows={6} placeholder="Optional preparation steps"/></label>

            {error && <div className="form-message error">{error}</div>}
            <div className="composer-footer-right"><button className="primary-button compact" disabled={saving}>{saving?'Saving…':editingRecipeId?'Save changes':'Add recipe'}</button></div>
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

            <label>Recipe<Select value={mealRecipeId} onChange={chooseRecipe} options={recipeOptions} ariaLabel="Choose saved recipe"/></label>

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

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.kind==='recipe'?'Remove recipe?':'Remove planned meal?'}
        message={confirm?.kind==='recipe'
          ? 'The recipe will be archived. Existing planned meals keep their name and date.'
          : 'This planned meal will be removed'+(confirm?.kind==='meal' && confirm.linkedEventId?' together with its linked Calendar entry.':'.')}
        confirmLabel="Remove"
        danger
        busy={saving}
        onCancel={()=>setConfirm(null)}
        onConfirm={()=>void confirmDelete()}
      />
    </div>
  )
}

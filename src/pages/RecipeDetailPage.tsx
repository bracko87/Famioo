import { ArrowLeft, ChefHat, Clock3, ExternalLink, Globe2, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useHousehold } from '../context/HouseholdContext'
import { supabase } from '../lib/supabase'

type Recipe={
  id:string
  title:string
  description:string|null
  meal_type:string
  prep_minutes:number|null
  servings:number|null
  instructions:string|null
  source_type:'own'|'imported'
  source_url:string|null
  source_site:string|null
  source_author:string|null
  source_image_url:string|null
}

type Ingredient={
  id:string
  item_text:string
  quantity:string|null
  sort_order:number
}

export function RecipeDetailPage(){
  const { recipeId }=useParams()
  const navigate=useNavigate()
  const { household }=useHousehold()
  const [recipe,setRecipe]=useState<Recipe|null>(null)
  const [ingredients,setIngredients]=useState<Ingredient[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')

  useEffect(()=>{
    if(!recipeId) return
    let cancelled=false

    void Promise.all([
      supabase
        .from('recipes')
        .select('id,title,description,meal_type,prep_minutes,servings,instructions,source_type,source_url,source_site,source_author,source_image_url')
        .eq('household_id',household.id)
        .eq('id',recipeId)
        .maybeSingle(),
      supabase
        .from('recipe_ingredients')
        .select('id,item_text,quantity,sort_order')
        .eq('household_id',household.id)
        .eq('recipe_id',recipeId)
        .order('sort_order'),
    ]).then(([recipeResult,ingredientResult])=>{
      if(cancelled) return
      if(recipeResult.error || !recipeResult.data){
        setError(recipeResult.error?.message ?? 'Recipe not found.')
      } else {
        setRecipe(recipeResult.data as Recipe)
      }
      if(ingredientResult.error) setError((current)=>current || ingredientResult.error.message)
      else setIngredients((ingredientResult.data??[]) as Ingredient[])
      setLoading(false)
    })

    return ()=>{cancelled=true}
  },[household.id,recipeId])

  return (
    <div className="page recipe-detail-page">
      <div className="recipe-detail-topbar">
        <button type="button" className="icon-button" onClick={()=>navigate(-1)} aria-label="Back to Recipe book">
          <ArrowLeft size={19}/>
        </button>
        <strong>Recipe</strong>
        <span/>
      </div>

      {loading && <div className="list-card empty-state">Opening recipe…</div>}
      {error && <div className="notice error">{error}</div>}

      {recipe && (
        <article className="recipe-detail">
          {recipe.source_image_url ? (
            <img className="recipe-detail-image" src={recipe.source_image_url} alt={recipe.title}/>
          ) : (
            <div className="recipe-detail-image-placeholder"><ChefHat size={38}/></div>
          )}

          <section className="recipe-detail-hero">
            <span className="eyebrow">{recipe.meal_type.toUpperCase()}</span>
            <h1>{recipe.title}</h1>
            {recipe.source_type==='imported' && (
              <div className="recipe-detail-source">
                <Globe2 size={14}/>
                <span>{recipe.source_site || 'Imported recipe'}</span>
                {recipe.source_url && (
                  <a href={recipe.source_url} target="_blank" rel="noreferrer">
                    Original source <ExternalLink size={12}/>
                  </a>
                )}
              </div>
            )}
            {recipe.description && <p>{recipe.description}</p>}
            <div className="recipe-detail-meta">
              {recipe.prep_minutes!=null && <span><Clock3 size={15}/>{recipe.prep_minutes} min</span>}
              {recipe.servings!=null && <span><Users size={15}/>{recipe.servings} servings</span>}
              {recipe.source_author && <span>By {recipe.source_author}</span>}
            </div>
          </section>

          <section className="recipe-detail-section">
            <h2>Ingredients</h2>
            {ingredients.length ? (
              <div className="recipe-detail-ingredients">
                {ingredients.map((item)=>(
                  <div key={item.id}>
                    <strong>{item.quantity || '•'}</strong>
                    <span>{item.item_text}</span>
                  </div>
                ))}
              </div>
            ) : <p>No ingredients saved.</p>}
          </section>

          <section className="recipe-detail-section">
            <h2>Preparation</h2>
            <div className="recipe-detail-instructions">
              {(recipe.instructions||'No preparation steps saved.')
                .split(/\n+/)
                .filter(Boolean)
                .map((step,index)=><p key={index}>{step}</p>)}
            </div>
          </section>
        </article>
      )}
    </div>
  )
}

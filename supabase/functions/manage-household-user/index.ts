import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type Action = "invite" | "create" | "create_profile"
type IdentityType = "email" | "phone"
type ProfileType = "adult" | "child"

type RequestBody = {
  action: Action
  household_id: string
  email?: string
  phone?: string
  identity_type?: IdentityType
  profile_type?: ProfileType
  display_name?: string
  role?: "admin" | "user"
  password?: string
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Server configuration is incomplete." }, 500)
  }

  const authorization = req.headers.get("Authorization")
  if (!authorization) return json({ error: "Authentication required." }, 401)

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const {
    data: { user: caller },
    error: callerError,
  } = await userClient.auth.getUser()

  if (callerError || !caller) return json({ error: "Authentication required." }, 401)

  let body: RequestBody

  try {
    body = await req.json()
  } catch {
    return json({ error: "Invalid request body." }, 400)
  }

  const householdId = body.household_id?.trim()
  const email = body.email?.trim().toLowerCase() || undefined
  const phone = body.phone?.trim() || undefined
  const profileType: ProfileType = body.profile_type === "child" ? "child" : "adult"
  const action: Action = profileType === "child" ? "create_profile" : body.action
  const identityType: IdentityType = action === "invite"
    ? "email"
    : body.identity_type === "phone"
      ? "phone"
      : "email"
  const role = body.role === "admin" ? "admin" : "user"
  const displayName = body.display_name?.trim()
    || email?.split("@")[0]
    || phone
    || "Member"

  if (!householdId) return json({ error: "A household is required." }, 400)
  if (!["invite", "create", "create_profile"].includes(action)) {
    return json({ error: "Invalid action." }, 400)
  }
  if (!displayName.trim()) return json({ error: "Display name is required." }, 400)

  const [{ data: household, error: householdError }, { data: membership, error: membershipError }] = await Promise.all([
    adminClient
      .from("households")
      .select("timezone,created_by_user_id")
      .eq("id", householdId)
      .maybeSingle(),
    adminClient
      .from("household_members")
      .select("role,status")
      .eq("household_id", householdId)
      .eq("user_id", caller.id)
      .maybeSingle(),
  ])

  if (householdError || !household) return json({ error: "Household not found." }, 404)

  const callerIsOwner = household.created_by_user_id === caller.id
    || (!membershipError && membership?.status === "active" && membership?.role === "owner")

  if (!callerIsOwner) {
    return json({ error: "Only the household owner can add or invite users." }, 403)
  }

  if (profileType === "child") {
    const { data: childProfile, error: childError } = await adminClient
      .from("family_profiles")
      .insert({
        household_id: householdId,
        linked_user_id: null,
        display_name: displayName,
        profile_type: "child",
        color_key: "pink",
      })
      .select("id")
      .single()

    if (childError || !childProfile) {
      return json({ error: childError?.message ?? "Could not create the child profile." }, 400)
    }

    return json({
      ok: true,
      action: "create_profile",
      profile_id: childProfile.id,
      profile_type: "child",
      display_name: displayName,
    })
  }

  if (action === "invite") {
    if (!email || !email.includes("@")) {
      return json({ error: "A valid email address is required for invitations." }, 400)
    }
  } else {
    if (!body.password || body.password.length < 8) {
      return json({ error: "A temporary password of at least 8 characters is required." }, 400)
    }

    if (identityType === "email" && (!email || !email.includes("@"))) {
      return json({ error: "A valid email address is required." }, 400)
    }

    if (identityType === "phone" && (!phone || !phone.startsWith("+") || phone.length < 8)) {
      return json({ error: "Use a full international phone number, for example +491701234567." }, 400)
    }
  }

  let createdUserId: string | null = null

  try {
    const authResult = action === "invite"
      ? await adminClient.auth.admin.inviteUserByEmail(email!, {
          data: { display_name: displayName },
        })
      : identityType === "phone"
        ? await adminClient.auth.admin.createUser({
            phone: phone!,
            password: body.password!,
            phone_confirm: true,
            user_metadata: { display_name: displayName },
          })
        : await adminClient.auth.admin.createUser({
            email: email!,
            password: body.password!,
            email_confirm: true,
            user_metadata: { display_name: displayName },
          })

    if (authResult.error || !authResult.data.user) {
      return json({ error: authResult.error?.message ?? "Could not create the user." }, 400)
    }

    createdUserId = authResult.data.user.id

    const { error: profileError } = await adminClient
      .from("user_profiles")
      .upsert(
        {
          id: createdUserId,
          display_name: displayName,
          default_timezone: household.timezone,
        },
        {
          onConflict: "id",
          ignoreDuplicates: true,
        },
      )

    if (profileError) throw profileError

    const { error: memberError } = await adminClient
      .from("household_members")
      .upsert(
        {
          household_id: householdId,
          user_id: createdUserId,
          role,
          status: "active",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "household_id,user_id" },
      )

    if (memberError) throw memberError

    const { data: existingFamilyProfile, error: familyProfileReadError } = await adminClient
      .from("family_profiles")
      .select("id")
      .eq("household_id", householdId)
      .eq("linked_user_id", createdUserId)
      .eq("active", true)
      .maybeSingle()

    if (familyProfileReadError) throw familyProfileReadError

    if (!existingFamilyProfile) {
      const { error: familyProfileError } = await adminClient
        .from("family_profiles")
        .insert({
          household_id: householdId,
          linked_user_id: createdUserId,
          display_name: displayName,
          profile_type: "adult",
          color_key: role === "admin" ? "blue" : "green",
        })

      if (familyProfileError) throw familyProfileError
    }

    const { error: preferenceError } = await adminClient
      .from("notification_preferences")
      .upsert(
        {
          household_id: householdId,
          user_id: createdUserId,
          timezone: household.timezone,
        },
        {
          onConflict: "household_id,user_id",
          ignoreDuplicates: true,
        },
      )

    if (preferenceError) throw preferenceError

    return json({
      ok: true,
      action,
      user_id: createdUserId,
      email: authResult.data.user.email ?? null,
      phone: authResult.data.user.phone ?? null,
      role,
      profile_type: "adult",
    })
  } catch (error) {
    if (createdUserId) await adminClient.auth.admin.deleteUser(createdUserId)

    return json(
      { error: error instanceof Error ? error.message : "Could not add the user." },
      400,
    )
  }
})

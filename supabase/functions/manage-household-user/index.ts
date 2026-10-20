import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type Action = "invite" | "create" | "create_profile" | "received" | "sent" | "revoke"
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
  invitation_id?: string
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


type AuthUserSummary = {
  id: string
  email?: string
  email_confirmed_at?: string | null
}

async function findAuthUserByEmail(
  adminClient: ReturnType<typeof createClient>,
  email: string,
): Promise<AuthUserSummary | null> {
  // Admin listUsers is server-only. Never return the directory to the caller.
  // The lookup also avoids creating duplicate Auth users when inviting someone
  // who already has an account in another household.
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const match = data.users.find((user) => user.email?.trim().toLowerCase() === email)
    if (match) return match
    if (data.users.length < 1000) break
  }
  return null
}

function invitationId(body: RequestBody): string | null {
  const id = body.invitation_id?.trim() ?? ""
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null
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
  const action: Action = body.action === "received" || body.action === "sent" || body.action === "revoke"
    ? body.action
    : profileType === "child" ? "create_profile" : body.action
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

  if (!["invite", "create", "create_profile", "received", "sent", "revoke"].includes(action)) {
    return json({ error: "Invalid action." }, 400)
  }

  // An invited recipient has no household membership yet. Only list their
  // exact Auth-user-ID invitations; do not run the owner-context check here.
  if (action === "received") {
    const { data: rows, error } = await adminClient
      .from("household_invitations")
      .select("id,email,role,display_name,household_id,expires_at,requires_password")
      .eq("invited_auth_user_id", caller.id)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })

    if (error) return json({ error: "Could not load received invitations." }, 500)
    const ownEmail = caller.email?.trim().toLowerCase()
    const invitations = (rows ?? []).filter((row) => row.email?.toLowerCase() === ownEmail)
    const householdIds = [...new Set(invitations.map((row) => row.household_id))]
    const householdNames = new Map<string, string>()

    if (householdIds.length) {
      const { data: households, error: householdError } = await adminClient
        .from("households")
        .select("id,name")
        .in("id", householdIds)
        .is("archived_at", null)
      if (householdError) return json({ error: "Could not load invited households." }, 500)
      for (const household of households ?? []) householdNames.set(household.id, household.name)
    }
    return json({
      ok: true,
      invitations: invitations.filter((row) => householdNames.has(row.household_id)).map((row) => ({
        id: row.id,
        household_name: householdNames.get(row.household_id),
        role: row.role,
        expires_at: row.expires_at,
        requires_password: row.requires_password,
      })),
    })
  }

  if (!householdId) return json({ error: "A household is required." }, 400)
  if (!displayName.trim()) return json({ error: "Display name is required." }, 400)

  const { data: ownerRows, error: ownerError } = await userClient.rpc(
    "owner_household_context_v1",
    { p_household_id: householdId },
  )

  const ownerContext = Array.isArray(ownerRows) ? ownerRows[0] : null

  if (ownerError || !ownerContext) {
    return json({
      error: "Only the household owner can add or invite users.",
      detail: ownerError?.message ?? "Owner context was not returned.",
    }, 403)
  }

  const household = {
    timezone: String(ownerContext.timezone || "Europe/Berlin"),
  }


  if (action === "sent") {
    const { data: rows, error } = await adminClient
      .from("household_invitations")
      .select("id,email,display_name,role,status,expires_at,created_at")
      .eq("household_id", householdId)
      .eq("status", "pending")
      .not("invited_auth_user_id", "is", null)
      .order("created_at", { ascending: false })
    if (error) return json({ error: "Could not load pending invitations." }, 500)
    return json({
      ok: true,
      invitations: (rows ?? []).map((row) => ({
        id: row.id,
        email: row.email,
        display_name: row.display_name,
        role: row.role,
        expires_at: row.expires_at,
        created_at: row.created_at,
      })),
    })
  }

  if (action === "revoke") {
    const id = invitationId(body)
    if (!id) return json({ error: "Invalid invitation identifier." }, 400)
    const { error } = await adminClient
      .from("household_invitations")
      .update({ status: "revoked" })
      .eq("id", id)
      .eq("household_id", householdId)
      .eq("status", "pending")
    if (error) return json({ error: "Could not cancel this invitation." }, 500)
    return json({ ok: true, action: "revoke" })
  }

  if (profileType === "child") {
    const { data: childProfileId, error: childError } = await userClient.rpc(
      "create_household_profile_v1",
      {
        p_household_id: householdId,
        p_display_name: displayName,
        p_profile_type: "child",
      },
    )

    if (childError || !childProfileId) {
      return json({ error: childError?.message ?? "Could not create the child profile." }, 400)
    }

    return json({
      ok: true,
      action: "create_profile",
      profile_id: childProfileId,
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

  try {
    if (action === "invite") {
      const existingPending = await adminClient
        .from("household_invitations")
        .select("id,email")
        .eq("household_id", householdId)
        .eq("status", "pending")
        .ilike("email", email!)
        .gt("expires_at", new Date().toISOString())
        .not("invited_auth_user_id", "is", null)
        .limit(1)

      if (existingPending.error) throw existingPending.error
      if (existingPending.data?.length) {
        return json({ error: "This email already has a pending invitation. Cancel it before creating another." }, 409)
      }

      const registeredUser = await findAuthUserByEmail(adminClient, email!)
      let recipient = registeredUser
      let emailRequested = false

      if (!recipient) {
        // A redirectTo value must be configured in Supabase's allowed URLs.
        // Otherwise, Supabase uses its Auth Site URL; never derive this from
        // the untrusted HTTP Origin request header.
        const site = Deno.env.get("FAMIOO_APP_URL")?.trim()
        const redirectTo = site && /^https:\/\//i.test(site)
          ? site.replace(/\/$/, "") + "/app"
          : undefined
        const invited = await adminClient.auth.admin.inviteUserByEmail(email!, {
          data: { display_name: displayName },
          ...(redirectTo ? { redirectTo } : {}),
        })
        if (invited.error || !invited.data.user) {
          return json({
            error: invited.error?.message ?? "Supabase could not request the invitation email.",
            detail: "Configure custom Auth SMTP and a valid Site URL/redirect URL. No household access was granted.",
          }, 400)
        }
        recipient = invited.data.user
        emailRequested = true
      } else if (!recipient.email_confirmed_at) {
        return json({
          error: "This email already has an unconfirmed Auth account. Verify the account or resolve its invitation in Supabase before inviting again.",
        }, 409)
      }

      const membership = await adminClient
        .from("household_members")
        .select("user_id")
        .eq("household_id", householdId)
        .eq("user_id", recipient.id)
        .eq("status", "active")
        .limit(1)
      if (membership.error) throw membership.error
      if (membership.data?.length) {
        return json({ error: "This person already has household access." }, 409)
      }

      const randomHash = Array.from(
        crypto.getRandomValues(new Uint8Array(32)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("")
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

      const { error: invitationError } = await adminClient
        .from("household_invitations")
        .insert({
          household_id: householdId,
          email,
          role,
          display_name: displayName,
          token_hash: randomHash,
          invited_by_user_id: caller.id,
          invited_auth_user_id: recipient.id,
          requires_password: !registeredUser,
          expires_at: expiresAt,
          status: "pending",
        })
      if (invitationError) throw invitationError

      // No membership or family profile is created at invitation time.
      return json({
        ok: true,
        action: "invite",
        status: "pending",
        delivery: emailRequested ? "requested" : "existing_account",
        message: emailRequested
          ? "Supabase accepted the email invitation request; delivery is not confirmed."
          : "Existing Famioo user invited in-app. No invitation email was sent; ask them to sign in and accept.",
      })
    }

    const authResult = identityType === "phone"
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

    const { data: attachedProfileId, error: attachError } = await userClient.rpc(
      "attach_household_user_v1",
      {
        p_household_id: householdId,
        p_user_id: authResult.data.user.id,
        p_display_name: displayName,
        p_role: role,
      },
    )
    if (attachError || !attachedProfileId) throw attachError ?? new Error("Could not attach the user.")

    return json({
      ok: true,
      action: "create",
      user_id: authResult.data.user.id,
      email: authResult.data.user.email ?? null,
      phone: authResult.data.user.phone ?? null,
      role,
      profile_type: "adult",
    })
  } catch (error) {
    console.error("manage-household-user failed", error)
    return json({
      error: error instanceof Error ? error.message : "Could not process household invitation.",
    }, 400)
  }
})

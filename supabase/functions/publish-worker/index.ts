import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.115.0";

type Job = { id:string; content_item_id:string; social_account_id:string; platform:"instagram"|"facebook"; publish_kind:"feed"|"story"|"reel"; scheduled_for:string; attempts:number; metadata:Record<string,any>|null };
type Content = { id:string; caption:string|null; media_type:"image"|"video"; primary_asset_path:string; ai_metadata:Record<string,any>|null };
type Account = { id:string; external_account_id:string; platform:"instagram"|"facebook" };
type Asset = { storage_path:string; media_type:"image"|"video"; position:number; signedUrl:string };
type Published = { externalId:string; externalUrl:string|null };

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(supabaseUrl, serviceRole, { auth: { persistSession:false, autoRefreshToken:false } });

async function jsonFetch(url:string, init?:RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let data:any; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw:text }; }
  if (!res.ok || data?.error) throw new Error(data?.error?.message || data?.error?.error_user_msg || `${res.status} ${text.slice(0,300)}`);
  return data;
}
function body(params:Record<string,string|number|boolean|undefined|null>) {
  const p = new URLSearchParams(); Object.entries(params).forEach(([k,v])=>{ if(v!==undefined&&v!==null&&v!=="") p.set(k,String(v)); }); return p;
}
async function graph(version:string, path:string, token:string, params:Record<string,any>, method="POST", graphVideo=false) {
  const host = graphVideo ? "https://graph-video.facebook.com" : "https://graph.facebook.com";
  if (method === "GET") {
    const q = body({ ...params, access_token:token });
    return jsonFetch(`${host}/${version}/${path}?${q}`);
  }
  return jsonFetch(`${host}/${version}/${path}`, { method, headers:{"content-type":"application/x-www-form-urlencoded"}, body:body({ ...params, access_token:token }) });
}
async function waitInstagram(version:string, creationId:string, token:string) {
  for (let i=0;i<24;i++) {
    const s = await graph(version, creationId, token, { fields:"status_code,status" }, "GET");
    if (s.status_code === "FINISHED") return;
    if (["ERROR","EXPIRED"].includes(s.status_code)) throw new Error(`Instagram processing ${s.status_code}: ${s.status || ""}`);
    await new Promise(r=>setTimeout(r,5000));
  }
  throw new Error("Instagram media processing timeout");
}
async function publishInstagram(version:string, accountId:string, token:string, mediaUrl:string, mediaType:"image"|"video", kind:"feed"|"story"|"reel", caption:string) {
  const params:Record<string,any> = {};
  if (kind === "story") params.media_type = "STORIES";
  if (kind === "reel") params.media_type = "REELS";
  if (mediaType === "video") params.video_url = mediaUrl; else params.image_url = mediaUrl;
  if (kind !== "story" && caption) params.caption = caption;
  if (kind === "reel") params.share_to_feed = true;
  if (mediaType === "video" && kind === "feed") throw new Error("Video Instagram Feed harus dipilih sebagai Reel pada V1");
  const container = await graph(version, `${accountId}/media`, token, params);
  if (!container.id) throw new Error("Instagram tidak mengembalikan creation_id");
  if (mediaType === "video" || kind === "story") await waitInstagram(version, container.id, token);
  const published = await graph(version, `${accountId}/media_publish`, token, { creation_id:container.id });
  const externalId = published.id;
  let externalUrl:string|null = null;
  try { const info = await graph(version, externalId, token, { fields:"permalink" }, "GET"); externalUrl = info.permalink || null; } catch { /* optional */ }
  return { externalId, externalUrl };
}
async function publishInstagramCarousel(version:string, accountId:string, token:string, assets:Asset[], caption:string):Promise<Published> {
  const children:string[]=[];
  for (const asset of assets) {
    if (asset.media_type !== "image") throw new Error("Carousel Instagram saat ini hanya mendukung gambar");
    const child=await graph(version,`${accountId}/media`,token,{image_url:asset.signedUrl,is_carousel_item:true});
    if (!child.id) throw new Error("Instagram tidak mengembalikan ID item carousel");
    await waitInstagram(version,child.id,token);
    children.push(String(child.id));
  }
  const container=await graph(version,`${accountId}/media`,token,{media_type:"CAROUSEL",children:children.join(","),caption});
  if (!container.id) throw new Error("Instagram tidak mengembalikan ID carousel");
  await waitInstagram(version,container.id,token);
  const published=await graph(version,`${accountId}/media_publish`,token,{creation_id:container.id});
  if (!published.id) throw new Error("Instagram tidak mengembalikan ID posting carousel");
  let externalUrl:string|null=null;
  try { const info=await graph(version,String(published.id),token,{fields:"permalink"},"GET");externalUrl=info.permalink||null; } catch {}
  return {externalId:String(published.id),externalUrl};
}
async function uploadHostedSession(uploadUrl:string, token:string, mediaUrl:string) {
  await jsonFetch(uploadUrl, { method:"POST", headers:{ Authorization:`OAuth ${token}`, file_url:mediaUrl } });
}
async function publishFacebook(version:string, pageId:string, token:string, mediaUrl:string, mediaType:"image"|"video", kind:"feed"|"story"|"reel", caption:string) {
  if (kind === "feed") {
    if (mediaType === "image") {
      const r = await graph(version, `${pageId}/photos`, token, { url:mediaUrl, caption, published:true });
      return { externalId:r.post_id || r.id, externalUrl:null };
    }
    const r = await graph(version, `${pageId}/videos`, token, { file_url:mediaUrl, description:caption }, "POST", true);
    return { externalId:r.id, externalUrl:null };
  }
  if (kind === "story" && mediaType === "image") {
    const photo = await graph(version, `${pageId}/photos`, token, { url:mediaUrl, published:false });
    const story = await graph(version, `${pageId}/photo_stories`, token, { photo_id:photo.id });
    let url:string|null=null;
    try { const stories=await graph(version, `${pageId}/stories`, token, { fields:"post_id,url", limit:25 }, "GET"); url=stories.data?.find((x:any)=>String(x.post_id)===String(story.post_id))?.url || null; } catch {}
    return { externalId:String(story.post_id || photo.id), externalUrl:url };
  }
  if (mediaType !== "video") throw new Error("Facebook Reel/Video Story membutuhkan video");
  const edge = kind === "reel" ? "video_reels" : "video_stories";
  const start = await graph(version, `${pageId}/${edge}`, token, { upload_phase:"start" });
  if (!start.video_id || !start.upload_url) throw new Error(`Facebook ${kind} upload session gagal dibuat`);
  await uploadHostedSession(start.upload_url, token, mediaUrl);
  const finish = await graph(version, `${pageId}/${edge}`, token, { upload_phase:"finish", video_id:start.video_id, video_state:"PUBLISHED", description:caption });
  const externalId = String(finish.post_id || finish.video_id || start.video_id);
  let externalUrl:string|null=null;
  if (kind === "story") {
    try { const stories=await graph(version, `${pageId}/stories`, token, { fields:"post_id,url", limit:25 }, "GET"); externalUrl=stories.data?.find((x:any)=>String(x.post_id)===externalId)?.url || null; } catch {}
  }
  return { externalId, externalUrl };
}
async function publishFacebookCarousel(version:string,pageId:string,token:string,assets:Asset[],caption:string):Promise<Published> {
  const photoIds:string[]=[];
  for (const asset of assets) {
    if (asset.media_type!=="image") throw new Error("Carousel Facebook saat ini hanya mendukung gambar");
    const photo=await graph(version,`${pageId}/photos`,token,{url:asset.signedUrl,published:false});
    if (!photo.id) throw new Error("Facebook tidak mengembalikan ID gambar carousel");
    photoIds.push(String(photo.id));
  }
  const params:Record<string,any>={message:caption};
  photoIds.forEach((id,index)=>{params[`attached_media[${index}]`]=JSON.stringify({media_fbid:id});});
  const published=await graph(version,`${pageId}/feed`,token,params);
  if (!published.id) throw new Error("Facebook tidak mengembalikan ID posting carousel");
  return {externalId:String(published.id),externalUrl:null};
}
async function settleContent(contentId:string) {
  const { data:rows } = await db.from("publish_jobs").select("status").eq("content_item_id",contentId);
  if (!rows?.length) return;
  if (rows.every(r=>r.status==="posted")) await db.from("content_items").update({status:"posted"}).eq("id",contentId);
  else if (rows.every(r=>["posted","failed","cancelled"].includes(r.status)) && rows.some(r=>r.status==="failed")) await db.from("content_items").update({status:"failed"}).eq("id",contentId);
  else await db.from("content_items").update({status:"publishing"}).eq("id",contentId);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only",{status:405});
  const candidate = req.headers.get("x-worker-secret") || "";
  const { data:allowed, error:authError } = await db.rpc("worker_secret_matches", { p_candidate:candidate });
  if (authError || !allowed) return new Response("Unauthorized",{status:401});
  const { data:versionData } = await db.rpc("worker_graph_version");
  const version = versionData || "v26.0";
  const { data:claimed, error:claimError } = await db.rpc("claim_due_publish_jobs", { p_batch_size:6 });
  if (claimError) return Response.json({ok:false,error:claimError.message},{status:500});
  const results:any[]=[];
  for (const job of (claimed || []) as Job[]) {
    try {
      const [{data:content,error:ce},{data:account,error:ae},{data:token,error:te}] = await Promise.all([
        db.from("content_items").select("id,caption,media_type,primary_asset_path,ai_metadata").eq("id",job.content_item_id).single(),
        db.from("social_accounts").select("id,external_account_id,platform").eq("id",job.social_account_id).single(),
        db.rpc("worker_get_social_token",{p_account_id:job.social_account_id}),
      ]);
      if (ce||ae||te||!content||!account||!token) throw new Error(ce?.message||ae?.message||te?.message||"Job data/token tidak lengkap");
      const c=content as Content, a=account as Account;
      const {data:assetRows,error:assetError}=await db.from("content_assets").select("storage_path,media_type,position").eq("content_item_id",job.content_item_id).order("position");
      if (assetError) throw new Error(assetError.message);
      const stored=(assetRows?.length?assetRows:[{storage_path:c.primary_asset_path,media_type:c.media_type,position:0}]) as Omit<Asset,"signedUrl">[];
      const assets:Asset[]=[];
      for (const asset of stored) {
        const {data:signed,error:se}=await db.storage.from("content-media").createSignedUrl(asset.storage_path,7200);
        if (se||!signed?.signedUrl) throw new Error(se?.message||"Signed URL gagal dibuat");
        assets.push({...asset,signedUrl:signed.signedUrl});
      }
      const format=String(c.ai_metadata?.content_format||((job.publish_kind==="story"&&assets.length>1)?"story":"feed"));
      let published:Published;
      let finalMetadata=job.metadata||{};
      if (format==="carousel"&&job.publish_kind==="feed") {
        published=job.platform==="instagram"
          ?await publishInstagramCarousel(version,a.external_account_id,token,assets,c.caption||"")
          :await publishFacebookCarousel(version,a.external_account_id,token,assets,c.caption||"");
      } else if (job.publish_kind==="story"&&assets.length>1) {
        const completed=new Set<number>((job.metadata?.published_asset_positions||[]).map(Number));
        const externalIds:string[]=[...(job.metadata?.story_external_ids||[]).map(String)];
        let latest:Published={externalId:externalIds.at(-1)||"",externalUrl:null};
        for (const asset of assets) {
          if (completed.has(asset.position)) continue;
          latest=job.platform==="instagram"
            ?await publishInstagram(version,a.external_account_id,token,asset.signedUrl,asset.media_type,"story","")
            :await publishFacebook(version,a.external_account_id,token,asset.signedUrl,asset.media_type,"story","");
          completed.add(asset.position);externalIds.push(latest.externalId);
          finalMetadata={...finalMetadata,published_asset_positions:[...completed].sort((x,y)=>x-y),story_external_ids:externalIds};
          await db.from("publish_jobs").update({metadata:finalMetadata,external_post_id:latest.externalId,external_post_url:latest.externalUrl}).eq("id",job.id);
        }
        if (!latest.externalId) throw new Error("Story tidak menghasilkan ID publikasi");
        published=latest;
      } else {
        const asset=assets[0];
        published=job.platform==="instagram"
          ?await publishInstagram(version,a.external_account_id,token,asset.signedUrl,asset.media_type,job.publish_kind,c.caption||"")
          :await publishFacebook(version,a.external_account_id,token,asset.signedUrl,asset.media_type,job.publish_kind,c.caption||"");
      }
      await db.from("publish_jobs").update({status:"posted",published_at:new Date().toISOString(),external_post_id:published.externalId,external_post_url:published.externalUrl,error_message:null,metadata:finalMetadata}).eq("id",job.id);
      await settleContent(job.content_item_id);
      results.push({id:job.id,status:"posted",externalId:published.externalId});
    } catch (e) {
      const message=e instanceof Error?e.message:String(e); const attempts=job.attempts; const final=attempts>=4;
      const retryAt=new Date(Date.now()+Math.min(60,5*Math.pow(2,Math.max(0,attempts-1)))*60000).toISOString();
      await db.from("publish_jobs").update({status:final?"failed":"retrying",error_message:message,scheduled_for:final?job.scheduled_for:retryAt}).eq("id",job.id);
      await settleContent(job.content_item_id);
      results.push({id:job.id,status:final?"failed":"retrying",error:message});
    }
  }
  return Response.json({ok:true,processed:results.length,results,version});
});

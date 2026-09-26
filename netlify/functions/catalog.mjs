import { adminClient, ok, preflight, clean } from './_client.mjs';

export async function handler(event){
  if(event.httpMethod==='OPTIONS') return preflight();
  if(event.httpMethod!=='GET') return ok({error:'Método no permitido'},405);
  try{
    const admin=adminClient();
    const slug=clean(event.queryStringParameters?.slug||'importb2b',80).toLowerCase();
    const {data:cfg,error:ce}=await admin.from('importb2b_catalog_settings').select('*').eq('public_slug',slug).eq('is_public',true).single();
    if(ce||!cfg) return ok({error:'Catálogo no disponible'},404);
    const {data:products,error:pe}=await admin.from('importb2b_products').select('id,name,category,description,primary_image_url').eq('owner_id',cfg.owner_id).eq('active',true).eq('catalog_visible',true).order('name');
    if(pe) throw pe;
    const ids=(products||[]).map(p=>p.id);
    let variants=[],stock=[],images=[];
    if(ids.length){
      const [vr,sr,ir]=await Promise.all([
        admin.from('importb2b_product_variants').select('id,product_id,sku,variant_name,price_ars,attributes').in('product_id',ids).eq('active',true).order('variant_name'),
        admin.from('importb2b_stock_summary').select('product_id,variant_id,available').in('product_id',ids),
        admin.from('importb2b_product_images').select('product_id,image_url,thumbnail_url,is_primary,sort_order').in('product_id',ids).order('is_primary',{ascending:false}).order('sort_order')
      ]);
      if(vr.error)throw vr.error;if(sr.error)throw sr.error;if(ir.error)throw ir.error;
      variants=vr.data||[];stock=sr.data||[];images=ir.data||[];
    }
    const sm=new Map(stock.map(s=>[s.variant_id,Number(s.available||0)]));
    const im=new Map(),tm=new Map();for(const x of images){if(!im.has(x.product_id)&&x.image_url)im.set(x.product_id,x.image_url);if(!tm.has(x.product_id)&&(x.thumbnail_url||x.image_url))tm.set(x.product_id,x.thumbnail_url||x.image_url);}
    const vm=new Map();for(const v of variants){const av=Math.max(0,sm.get(v.id)||0);if(!cfg.show_out_of_stock&&av<=0)continue;const a=vm.get(v.product_id)||[];a.push({id:v.id,name:v.variant_name,sku:v.sku,price_ars:Number(v.price_ars||0),in_stock:av>0,available:cfg.show_exact_stock?av:(av>0?1:0),attributes:v.attributes||{}});vm.set(v.product_id,a)}
    const safe=(products||[]).map(p=>({id:p.id,name:p.name,category:p.category,description:p.description,image_url:p.primary_image_url||im.get(p.id)||null,thumbnail_url:tm.get(p.id)||p.primary_image_url||im.get(p.id)||null,variants:vm.get(p.id)||[]})).filter(p=>p.variants.length);
    const {data:methods,error:me}=await admin.from('importb2b_payment_methods').select('id,code,name,adjustment_kind,adjustment_direction,adjustment_value,sort_order').eq('owner_id',cfg.owner_id).eq('active',true).order('sort_order');if(me)throw me;
    return ok({settings:{slug:cfg.public_slug,title:cfg.catalog_title,subtitle:cfg.catalog_subtitle,whatsapp_number:cfg.whatsapp_number,show_exact_stock:cfg.show_exact_stock,show_out_of_stock:cfg.show_out_of_stock,allow_pickup:cfg.allow_pickup,allow_shipping:cfg.allow_shipping,pickup_label:cfg.pickup_label,shipping_label:cfg.shipping_label,shipping_note:cfg.shipping_note,shipping_fee_ars:Number(cfg.shipping_fee_ars||0),min_order_ars:Number(cfg.min_order_ars||0)},payment_methods:(methods||[]).filter(m=>m.code!=='pay_later'||cfg.allow_pay_later_public),products:safe});
  }catch(e){return ok({error:e?.message||'Error cargando catálogo'},500)}
}

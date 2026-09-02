var t=(n,e)=>{const s=typeof e=="number"?{status:e}:e??{};return new Response(JSON.stringify(n),{...s,headers:{"Content-Type":"application/json; charset=utf-8",...s.headers}})};export{t as j};

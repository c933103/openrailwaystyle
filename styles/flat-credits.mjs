// Each provider may supply small HTML credits. Keep only text and ordinary
// links. Template parsing is inert; no provider nodes or attributes are adopted.
export function appendFlatCredits(container, credits, base) {
  const document=container.ownerDocument, output=document.createDocumentFragment();
  const template=document.createElement('template');
  const copy=(parent,node)=>{
    if(node.nodeType===3){parent.append(node.data);return;}
    if(node.nodeType!==1||['SCRIPT','STYLE','TEMPLATE'].includes(node.tagName))return;
    if(node.tagName==='A'){
      let url;
      try {url=new URL(node.getAttribute('href')||'',base);} catch {}
      if(node.getAttribute('href') && ['https:','http:'].includes(url?.protocol)){
        const link=document.createElement('a');
        link.href=url.href;
        link.target='_blank';
        link.rel='noopener noreferrer';
        link.textContent=node.textContent;
        parent.append(link);
        return;
      }
    }
    for(const child of node.childNodes)copy(parent,child);
  };
  for(const credit of new Set(credits.filter(Boolean))){
    template.innerHTML=credit;
    const row=document.createElement('div');
    for(const child of template.content.childNodes)copy(row,child);
    if(row.textContent.trim())output.append(row);
  }
  container.replaceChildren(output);
}

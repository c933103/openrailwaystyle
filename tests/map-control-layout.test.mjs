// Geometry-unit regressions. The browser matrix separately checks the actual
// CSS, app, hit testing and MapLibre; these isolate measured layout decisions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {installControlLayout} from '../styles/map-controls.mjs';
const overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
function fixture(width,height,stackHeight,expanded,openDetails){
  const dom=new JSDOM('<div id="frame"><div id="map"><div class="maplibregl-ctrl-bottom-left"></div><details class="maplibregl-ctrl-attrib" open><div class="maplibregl-ctrl-attrib-inner"></div></details></div><aside id="panel"></aside><div id="status"></div><div id="details" hidden></div></div>',{pretendToBeVisual:true});
  const {window}=dom,document=window.document,root=document.documentElement;
  window.innerWidth=width;window.innerHeight=height;
  const element=id=>document.getElementById(id),number=(name,fallback)=>parseFloat(root.style.getPropertyValue(name))||fallback;
  const rect=(left,top,w,h)=>({left,top,width:w,height:h,right:left+w,bottom:top+h});
  const frame=element('frame'),mapElement=element('map'),panel=element('panel'),status=element('status'),details=element('details');
  const corner=document.querySelector('.maplibregl-ctrl-bottom-left'),credits=document.querySelector('.maplibregl-ctrl-attrib-inner');
  frame.getBoundingClientRect=()=>rect(0,0,width,height);
  details.hidden=!openDetails;
  details.getBoundingClientRect=()=>{
    const h=width<=650?height*0.45:Math.min(height-80,parseFloat(details.style.maxHeight)||height-80);
    return width<=650?rect(10,height-42-h,width-20,h):rect(width-370,20,310,h);
  };
  panel.getBoundingClientRect=()=>rect(10,10,expanded?310:48,Math.min(expanded?height-70:48,number('--map-panel-height',height)));
  status.getBoundingClientRect=()=>rect(18,height-115,width-36,60);
  corner.getBoundingClientRect=()=>rect(number('--map-control-left',0),height-number('--map-control-bottom',0)-stackHeight,Math.min(354,number('--map-control-width',354)),stackHeight);
  credits.getBoundingClientRect=()=>{
    const w=Math.min(330,number('--map-info-width',330)),h=Math.min(2000,number('--map-info-height',2000));
    return rect(width-number('--map-info-right',10)-w,height-number('--map-info-bottom',10)-40-h,w,h);
  };
  const layout=installControlLayout({frame,mapElement,panel,status,details});
  // A second pass represents the ResizeObserver delivery after the menu cap
  // or readout width changes; its result must be stable, not drift off-screen.
  layout.update();
  return{dom,layout,corner,credits,panel,status,details};
}
for(const [width,height] of [[1365,900],[800,400],[412,915],[320,568]])
  for(const expanded of [true,false])for(const stackHeight of [22,42,100])for(const openDetails of [false,true])
    test(`long credits leave room for controls: ${width}x${height}, menu=${expanded}, stack=${stackHeight}, details=${openDetails}`,()=>{
      const f=fixture(width,height,stackHeight,expanded,openDetails);
      try{
        const stack=f.corner.getBoundingClientRect(),credits=f.credits.getBoundingClientRect();
        assert.ok(stack.top>=10&&stack.left>=10&&stack.right<=width&&stack.bottom<=height,'stack is visible and inside the viewport');
        assert.equal(overlaps(stack,credits),false,'credits cannot cover the stack');
        assert.equal(overlaps(stack,f.panel.getBoundingClientRect()),false,'menu cannot cover the stack');
        assert.equal(overlaps(stack,f.status.getBoundingClientRect()),false,'status cannot cover the stack');
        if(openDetails)assert.equal(overlaps(stack,f.details.getBoundingClientRect()),false,'details cannot cover the stack');
        assert.ok(credits.top>=10&&credits.height<2000,'long credits have a bounded scrolling height');
        const before=f.corner.getBoundingClientRect();f.layout.update();
        assert.deepEqual(f.corner.getBoundingClientRect(),before,'layout converges');
      }finally{f.layout.destroy();assert.equal(f.details.style.maxHeight,'','cleanup restores the original detail height');f.dom.window.close();}
    });

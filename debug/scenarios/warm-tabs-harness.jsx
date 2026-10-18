import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/AppShell.jsx';
import { AuthContext } from '../../src/contexts/AuthContext.jsx';
import { MSGraphContext } from '../../src/contexts/MSGraphContext.jsx';
import '../../src/styles.css';
import '../../src/styles/tokens.css';
import '../../src/styles/states.css';
const noop = () => {};
const cloud = new URLSearchParams(location.search).has('cloud');
const user = {id:'dev-test-user',email:'warm-tabs@example.invalid',user_metadata:{full_name:'Warm Tab Test',first_name:'Warm',last_name:'Tab Test'}};
const auth = {user,session:null,loading:false,isAuthenticated:false,isSupabaseAvailable:false,tier:'developer',plan:'developer',features:{cloudSync:cloud,advancedSurvey:true,excelExport:true},signOut:noop};
const ms = {isAuthenticated:false,isLoading:false,account:null,graphClient:null,connectionRestored:true,needsReconnect:false,login:noop,logout:noop,ensureFreshToken:async()=>true};
const blob = await (await fetch('/debug-fixtures/e2e/prog-02-text-markup.pdf')).blob();
window.warmReads = {A:0,B:0};
const files = ['A','B'].map(name => {
 const file = new File([blob], `${name}.pdf`, {type:'application/pdf'});
 if (cloud) { file.id = `warm-cloud-${name}`; file.user_id = user.id; }
 const read = file.arrayBuffer.bind(file);
 file.arrayBuffer = () => { window.warmReads[name]++; return read(); };
 return file;
});
window.__devTestPdfs = files;
window.__devTestPdf = files[0];
createRoot(document.getElementById('root')).render(<AuthContext.Provider value={auth}><MSGraphContext.Provider value={ms}><App /></MSGraphContext.Provider></AuthContext.Provider>);

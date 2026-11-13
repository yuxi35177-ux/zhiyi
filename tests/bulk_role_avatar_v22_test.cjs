const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const mod=require('../app/src/main/assets/avatar-batch.js');
const sessions=[
 {id:'a1',characterName:'示例甲',name:'示例甲・日常',userAvatarData:'user_pic'},
 {id:'a2',characterName:'示例甲',name:'示例甲·复习',characterAvatarData:'old_pic'},
 {id:'b1',characterName:'示例乙',name:'家教'},
 {id:'c1',characterName:'AI',name:'示例丙'},
 {id:'d1',characterName:'黎夜',name:'黎夜'},
];
assert.equal(mod.fileRoleKey('头像_示例甲.JPG'),'示例甲');
assert.equal(mod.fileRoleKey('示例乙头像.png'),'示例乙');
assert.equal(mod.fileRoleKey('/Phone/Pictures/示例丙.webp'),'示例丙');
assert.equal(mod.fileRoleKey('陌生角色.png'),'陌生');
const normal=mod.planSameAvatar(sessions,false);
assert.equal(normal.assignments.length,4,'do not overwrite a prior role avatar by default');
assert.ok(!normal.assignments.some(x=>x.sessionId==='a2'));
assert.equal(mod.planSameAvatar(sessions,true).assignments.length,5,'explicit overwrite updates all');
const named=mod.planNamedAvatars(sessions,['示例甲.jpg','示例乙.png','示例丙.webp']);
assert.deepEqual(named.assignments.map(x=>x.sessionId).sort(),['a1','b1','c1']);
assert.equal(named.existing,1);
assert.equal(named.unmatched,1);
const namedOverwrite=mod.planNamedAvatars(sessions,['示例甲.jpg','示例乙.png','示例丙.webp'],true);
assert.deepEqual(namedOverwrite.assignments.filter(x=>x.fileIndex===0).map(x=>x.sessionId).sort(),['a1','a2']);
const duplicate=mod.planNamedAvatars(sessions,['示例甲.png','头像_示例甲.jpg'],true);
assert.equal(duplicate.ambiguous,2,'ambiguous image choices should not overwrite');
assert.ok(!duplicate.assignments.length);
const app=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/index.html'),'utf8');
assert.match(app,/case 'pick-avatar-batch'/);
assert.match(app,/data-action=\\?"bulk-role-avatar/);
assert.match(app,/avatarBatchTarget=\{mode,overwrite\}/);
assert.match(app,/!job\.overwrite&&session\.characterAvatarData/); // explicit pre-save guard
assert.match(app,/await Store\.put\('sessions',session\)/);
assert.match(html,/role-avatar-batch-picker.*multiple/);
assert.match(html,/script src="avatar-batch\.js"/);
assert.ok(html.indexOf('avatar-batch.js')<html.indexOf('app.js'));
const gradle=fs.readFileSync(path.join(__dirname,'../app/build.gradle'),'utf8');
assert.match(gradle,/versionCode 26/);
console.log('v2.2 bulk role avatar tests passed');

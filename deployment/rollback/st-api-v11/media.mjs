// Check actual magic bytes; never trust a filename or browser Content-Type.
export function validatePhoto(bytes,mime) {
 if(bytes.length>5*1024*1024)throw new Error('Photo is too large');
 const allowed={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
 if(!allowed[mime])throw new Error('Unsupported photo format');
 const has=(offset,values)=>values.every((v,i)=>bytes[offset+i]===v);
 const valid=mime==='image/jpeg'?has(0,[255,216,255]):mime==='image/png'?has(0,[137,80,78,71,13,10,26,10]):has(0,[82,73,70,70])&&has(8,[87,69,66,80]);
 if(!valid)throw new Error('Photo content does not match its format');
 return allowed[mime];
}

export function validateMedia(bytes,mime){
 if(mime.startsWith('image/'))return validatePhoto(bytes,mime);
 if(!['video/mp4','video/webm'].includes(mime))throw new Error('Unsupported media format');
 if(bytes.length>50*1024*1024)throw new Error('Video is too large');
 const has=(offset,values)=>values.every((v,i)=>bytes[offset+i]===v);
 if(!(mime==='video/mp4'?has(4,[102,116,121,112]):has(0,[26,69,223,163])))throw new Error('Video content does not match its format');
 return mime==='video/mp4'?'mp4':'webm';
}

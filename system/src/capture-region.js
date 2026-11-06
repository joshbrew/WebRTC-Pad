// Rectangles are pixels in the original source, before quality scaling.
export function captureRegion(value, size) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    if (!/^\d+,\d+,\d+,\d+$/.test(value)) throw new Error('Invalid capture area');
    const [x,y,width,height]=value.split(',').map(Number);value={x,y,width,height};
  }
  if (!value || !['x','y','width','height'].every(k=>Number.isSafeInteger(value[k])) ||
      value.x<0 || value.y<0 || value.width<2 || value.height<2 || value.x+value.width>32768 || value.y+value.height>32768)
    throw new Error('Choose an area at least 2 × 2 pixels inside the shared source.');
  if (size && (value.x+value.width>size.width || value.y+value.height>size.height))
    throw new Error('The selected area is outside this source. Select the area again.');
  return Object.fromEntries(['x','y','width','height'].map(k=>[k,value[k]]));
}

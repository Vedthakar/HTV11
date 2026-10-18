export const SCORE_COLOR=['interpolate',['linear'],['get','evaluationScore'],0,'#c95a59',50,'#d97558',70,'#e4b568',85,'#b4c881',100,'#62b49b'];
export function evaluationIndex(records) {
  const index=new Map();
  for(const record of records)if(record.buildingId!==null){
    if(!index.has(record.buildingId))index.set(record.buildingId,[]);
    index.get(record.buildingId).push(record);
  }
  return index;
}
export function decorateBuildings(collection,index) {
  return {...collection,features:collection.features.map(feature=>{
    const records=index.get(feature.id)||[],scores=records.map(r=>r.score).filter(v=>v!==null);
    return {...feature,properties:{...feature.properties,evaluationScore:scores.length?Math.min(...scores):null,evaluationCount:records.length}};
  })};
}
export function evaluationPoints(records) {
  return {type:'FeatureCollection',features:records.filter(r=>r.latitude!==null&&r.longitude!==null).map((r,i)=>({
    type:'Feature',id:i,geometry:{type:'Point',coordinates:[r.longitude,r.latitude]},
    properties:{recordId:r.id,evaluationScore:r.score,address:r.address},
  }))};
}

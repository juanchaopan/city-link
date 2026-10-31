// 验证"公共用地和未划分空地都没有时提示缺少用地"：把所有空地都划成住宅，再跑一次地块生成器。
import { generateCity } from '../web/sim/city.js';
import { generateParcels, ZONE } from '../web/sim/parcels.js';

const city = generateCity(32);
const zones = city.zones.map((zone) => (zone === ZONE.farm ? zone : ZONE.residential));
const density = city.density.map((value) => value || 1);
const result = generateParcels({ N: 32, roads: city.roads, water: city.water, slopes: city.slopes, zones, density, seed: 11 });
const shortages = [...new Set(result.services.shortages.map((item) => item.name))];
const onZonedLand = result.parcels.filter((parcel) => parcel.shape === 'service').length;
console.log(JSON.stringify({ shortages, servicesBuilt: onZonedLand }));

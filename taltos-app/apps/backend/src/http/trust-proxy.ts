import proxyAddr from '@fastify/proxy-addr';

/**
 * Pontosan egy megbízott proxy-hop: csak a közvetlen kapcsolat (a frontend-konténer nginx-e,
 * D50) által adott X-Forwarded-For bejegyzést fogadjuk el, és csak akkor, ha a kapcsolat a
 * megadott címről/hálózatról jön. A kliens saját XFF-bejegyzései (hop ≥ 1) soha nem számítanak,
 * így egy privát hálózatról érkező kliens sem hamisíthatja az IP-jét. (A Fastify szám alapú
 * hop-beállítása 5.12 óta szándékosan semmit sem bízik meg, ezért kell ez a függvény.)
 */
export function trustImmediateProxy(addresses: string): (address: string, hop: number) => boolean {
  const isTrusted = proxyAddr.compile(addresses.split(',').map((item) => item.trim()));
  return (address, hop) => hop === 0 && isTrusted(address, hop);
}

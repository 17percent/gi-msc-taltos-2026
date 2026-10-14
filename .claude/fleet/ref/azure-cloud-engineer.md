# Azure / Cloud Engineer — reference (on demand)

## Eszközhasználati irányelvek

- **Azure CLI (`az`)** az elsődleges eszköz. Mielőtt bármit módosítasz: `az account show` (subscription és tenant ellenőrzés), majd `az ... show/list` az állapot felmérésére.
- **Bicep / Terraform**: módosítás előtt `az deployment group what-if` vagy `terraform plan`. Az `apply` / `deployment create` csak a what-if eredmény átnézése után, és destruktív változásnál a tulajdonos jóváhagyásával.
- **Kimenet szűrése**: használj `--query` (JMESPath) és `-o table|tsv|json` kapcsolókat, hogy ne legyen túl hosszú a kimenet. Secretet tartalmazó kimenetet (`az keyvault secret show`, `az storage account keys list`) ne jelenítsd meg; ha szükséges, csak a létezését vagy metaadatát ellenőrizd.
- **Hálózati diagnosztika**: `nslookup` / `dig`, `curl -v`, `nc -zv`, Azure Network Watcher (connection troubleshoot, NSG flow log, effective routes, effective security rules).
- **Fájlműveletek**: a Read / Edit / Write eszközöket használd fájlokhoz, ne `cat`/`sed`/`echo` parancsokat, ha van dedikált eszköz. Független hívásokat futtass párhuzamosan.
- **Webes keresés / dokumentáció**: ha egy Azure szolgáltatás viselkedése, korlátja vagy API verziója bizonytalan, nézd meg a hivatalos Microsoft Learn dokumentációt (WebSearch / WebFetch), ne emlékezetből válaszolj. Az Azure gyorsan változik.
- **Hitelesítés**: ha interaktív login kell (`az login`), kérd meg a tulajdonost, hogy futtassa a `! az login` parancsot a promptban. Ne automatizáld a bejelentkezést és ne tárolj credentialt (lásd a Runtime contract „Hard limits" sorát).
- **Erőforrás-nevek és tagek**: kövesd a meglévő naming convention-t. Ha nincs, javasolj egyet, és egyeztesd a tulajdonossal, mielőtt létrehozol valamit.
- **Takarítás**: ideiglenes erőforrásokat, teszt-deploymenteket a munka végén jelezd és (jóváhagyással) takarítsd el.

## Domain-specifikus ellenőrzőlisták

### Új erőforrás létrehozása előtt
1. Melyik subscription, resource group, régió, környezet (dev / test / prod)?
2. Mi a naming convention és a kötelező tag-készlet?
3. Kell-e privát hálózat (Private Endpoint + privát DNS), és le van-e tiltva a publikus hozzáférés?
4. Hogyan hitelesít az alkalmazás (managed identity + RBAC, nem kulcs)?
5. Hol vannak a secretek (Key Vault), és ki fér hozzájuk?
6. Van-e diagnostic settings / monitoring / riasztás?
7. Mennyibe kerül nagyságrendileg?

### Key Vault
- RBAC modell előnyben az access policy-val szemben.
- Soft delete és purge protection bekapcsolva prod-on.
- Private Endpoint, publikus hozzáférés tiltva vagy szigorúan szűkítve.
- Secret rotáció és lejárat tervezése; alkalmazásból Key Vault referencia vagy SDK + managed identity.

### Managed identity és RBAC
- A user-assigned identity jó, ha több erőforrásnak kell ugyanaz az identitás; a system-assigned az erőforrás életciklusához kötött.
- Szerepkört a lehető legszűkebb scope-on adj (resource > resource group > subscription). Owner / Contributor széles scope-on csak indokolt esetben.
- Az RBAC propagáció késhet; hiba esetén várj pár percet, mielőtt újraépítesz bármit.

### Privát hálózat és DNS
- A Private Endpoint csak akkor működik, ha a privát DNS zóna is létezik, és linkelve van a megfelelő VNet-hez.
- Hibakeresésnél először a DNS feloldást nézd (a név a privát IP-re oldódik-e), utána az NSG-t és a route-okat.
- Hibrid környezetben (on-prem) DNS forwarder / Private Resolver kell.

### Környezet-izoláció
- Külön identitások, külön Key Vault, külön storage környezetenként; prod adat nem kerül dev-be.
- Prod-on változtatás előtt mindig egyeztess a tulajdonossal, és készíts what-if / plan eredményt.
- Policy-vel (Azure Policy) kényszeríthető a tag, a régió, a publikus hozzáférés tiltása.

### Konténerek és hosting
- ACR-hez pull jog managed identity-vel (AcrPull), nem admin user.
- Container Apps / AKS esetén a secret Key Vault-ból jöjjön, ne image-be vagy env fájlba égetve.
- Deployment slot vagy revision használata zero-downtime váltáshoz.

### Storage
- Shared key hozzáférés letiltása, ahol lehet; Entra ID + RBAC preferált.
- Ha SAS szükséges: rövid lejárat, szűk jogosultság, user delegation SAS.
- Tűzfal / Private Endpoint, HTTPS kötelező, minimum TLS verzió beállítva.

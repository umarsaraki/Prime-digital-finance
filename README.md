# PDF USDT — Cloudflare Worker Finance App

Wannan manhaja tana aiki ne da **Cloudflare Workers** da **Cloudflare D1** domin gudanar da asusun masu amfani, ma'amalolin **USDT**, *daily check-in*, tsarin **VIP plans** da ake sarrafawa kai tsaye daga **Admin Panel**, da kuma sanarwar cire kuɗi (*withdrawals*) zuwa **Telegram**.

---

## Babban Abin Da Manhajar Ke Yi

* **Rajista da Shiga Asusu (`/api/auth`)**: Ƙirƙirar asusu tare da lambar ID (`PDFXXXXXX`), *password hash* (`SHA-256`), da bayar da **VIP 0 Welcome Bonus** (gwajin kwana 3).
* **Bayanan Mai Amfani & Ma'amaloli (`/api/user`)**: Duba ma'aunin USDT, matakin VIP, ranar ƙarewar VIP, bayanan walat, da jerin ma'amaloli.
* **Daily Check-In (`/api/checkin`)**: Masu amfani za su iya karɓar ladar **+0.20 USDT** duk bayan sa'o'i 24.
* **Saye da Haɓaka VIP Plans (`/api/buy-vip`)**: Siyan ko haɓaka VIP plans da ke cikin database (`vip_plans`) tare da lissafin kwanakin aiki (`duration_days`) da kuma *50% upgrade refund* idan an haɓaka daga VIP da yake kan aiki.
* **Deposit & Withdrawal (`/api/deposit`, `/api/withdraw`)**: Ƙara USDT a walat ko buƙatar cire USDT (mafi ƙaranci **2.00 USDT**) tare da adireshin walat (`TRC20`, `BEP20`, `ERC20`) da lambobin sirri na **PIN (lambobi 4)**.
* **Admin Panel (`/api/admin/*`)**:
  * Ƙara sabbin VIP plans, gyara farashi (`price_usdt`), ribar rana (`daily_usdt`), da tsawon kwanaki (`duration_days`), ko goge plan.
  * Saita lambobin **Telegram Chat IDs** (`admin_settings`).
  * Ƙara sabbin **Super Admins** (`super_admins`).
  * Amincewa (`Approve`) ko ƙin (`Reject`) buƙatun cire USDT (idan aka ƙi *Pending* withdrawal, kuɗin yana komawa ma'aunin mai amfani).

---

## Saita Cloudflare D1 Da Variables

### 1. Ƙirƙira da Haɗa D1 Database
1. Shiga **Cloudflare Dashboard** > **Workers & Pages** > **D1 SQL Database**.
2. Tabbatar kana da database ɗin **`pdf_usdt_db`** (`13b389e0-784a-477c-8ae9-1369f637b6b5`).
3. A cikin **Worker** ɗinka, je zuwa **Settings** > **Bindings** > **Add binding** > **D1 database**.
4. Sa **Variable name** ya zama **`DB`**, sannan ka zaɓi **`pdf_usdt_db`**, ka danna **Save**.

*(Babu buƙatar gudanar da SQL da hannu kafin fara aiki saboda `initDatabase(env.DB)` tana ƙirƙirar teburan `users`, `transactions`, `vip_plans`, `admin_settings`, da `super_admins` ta atomatik a farkon buƙata.)*

### 2. Saita Environment Variables / Secrets (Na Zaɓi)
A cikin **Worker** ɗinka > **Settings** > **Variables and Secrets**, za ka iya ƙara:
* **`TELEGRAM_BOT_TOKEN`**: Token na Telegram bot ɗinka domin aika sanarwar sabon *withdrawal request*.
* **`TELEGRAM_CHAT_IDS`** *(na zaɓi)*: Lambobin Telegram chat a matsayin *fallback* idan ba a sa a Admin Panel ba.

---

## Shiga Admin Panel

* Babban Super Admin na farko shi ne: **`umarsaraki96@gmail.com`**.
* Bayan ka ɗora koodin Worker ɗinka, buɗe adireshin Worker ɗin a *browser* ka yi *login* da **`umarsaraki96@gmail.com`**.
* Maɓallin **Admin Panel** zai bayyana a saman shafin domin fara sarrafa VIP plans, Telegram IDs, Super Admins, da *withdrawals*.
* 

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { getStorage } from 'firebase-admin/storage';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { randomInt } from 'node:crypto';

initializeApp();
const db = getFirestore();
const region = 'asia-southeast1';
const USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;

function uidOf(request: { auth?: { uid: string } | null }): string {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Silakan login terlebih dahulu.');
  return request.auth.uid;
}

function cleanText(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', `${label} tidak valid.`);
  const result = value.trim();
  if (!result || result.length > max) throw new HttpsError('invalid-argument', `${label} harus 1–${max} karakter.`);
  return result;
}

async function blocked(a: string, b: string): Promise<boolean> {
  const [ab, ba] = await Promise.all([
    db.doc(`users/${a}/blocks/${b}`).get(),
    db.doc(`users/${b}/blocks/${a}`).get()
  ]);
  return ab.exists || ba.exists;
}

export const createProfile = onCall({ region }, async (request) => {
  const uid = uidOf(request);
  const username = cleanText(request.data?.username, 20, 'Username').toLowerCase();
  const displayName = cleanText(request.data?.displayName ?? username, 20, 'Nama tampilan');
  if (!USERNAME_RE.test(username)) throw new HttpsError('invalid-argument', 'Username: 3–20 karakter, hanya huruf, angka, titik, dan garis bawah.');
  const userRef = db.doc(`users/${uid}`);
  const usernameRef = db.doc(`usernames/${username}`);
  const existing = await userRef.get();
  if (existing.exists) return { ok: true, number: existing.get('number'), profile: existing.data() };

  for (let attempt = 0; attempt < 12; attempt++) {
    const number = String(randomInt(1_000_000_000, 9_999_999_999));
    const numberRef = db.doc(`numbers/${number}`);
    const result = await db.runTransaction(async (tx) => {
      const [u, n, current] = await Promise.all([tx.get(usernameRef), tx.get(numberRef), tx.get(userRef)]);
      if (current.exists) return current.data()!;
      if (u.exists && u.get('uid') !== uid) throw new HttpsError('already-exists', 'Username sudah digunakan.');
      if (n.exists) return false;
      const profile = {
        uid, username, displayName, number,
        avatarUrl: '', about: 'Available',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        online: true
      };
      tx.set(usernameRef, { uid, createdAt: FieldValue.serverTimestamp() });
      tx.set(numberRef, { uid });
      tx.set(userRef, profile);
      return profile;
    });
    if (result) return { ok: true, number: String((result as { number?: string }).number || number), profile: result };
  }
  throw new HttpsError('resource-exhausted', 'Tidak berhasil membuat nomor unik. Coba lagi.');
});

export const lookupByNumber = onCall({ region }, async (request) => {
  const uid = uidOf(request);
  const number = String(request.data?.number ?? '').replace(/\D/g, '');
  if (!/^\d{10}$/.test(number)) throw new HttpsError('invalid-argument', 'Nomor Veyra harus 10 digit.');
  const numberDoc = await db.doc(`numbers/${number}`).get();
  if (!numberDoc.exists) throw new HttpsError('not-found', 'Akun tidak ditemukan.');
  const targetUid = String(numberDoc.get('uid'));
  if (targetUid === uid) throw new HttpsError('failed-precondition', 'Itu nomor akunmu sendiri.');
  if (await blocked(uid, targetUid)) throw new HttpsError('permission-denied', 'Kontak tidak tersedia.');
  const profile = await db.doc(`users/${targetUid}`).get();
  if (!profile.exists) throw new HttpsError('not-found', 'Akun tidak ditemukan.');
  const p = profile.data()!;
  return { uid: targetUid, number, username: p.username, displayName: p.displayName, avatarUrl: p.avatarUrl || '', about: p.about || '' };
});

export const openDirectChat = onCall({ region }, async (request) => {
  const uid = uidOf(request);
  const targetUid = cleanText(request.data?.targetUid, 128, 'Kontak');
  if (targetUid === uid) throw new HttpsError('invalid-argument', 'Tidak bisa chat dengan akun sendiri.');
  const target = await db.doc(`users/${targetUid}`).get();
  if (!target.exists) throw new HttpsError('not-found', 'Akun tidak ditemukan.');
  if (await blocked(uid, targetUid)) throw new HttpsError('permission-denied', 'Chat tidak tersedia karena salah satu akun memblokir akun lain.');
  const pair = [uid, targetUid].sort();
  const conversationId = `d_${pair[0]}_${pair[1]}`;
  const ref = db.doc(`conversations/${conversationId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) tx.set(ref, {
      type: 'direct', members: pair, createdBy: uid,
      admins: [], createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      lastMessage: null
    });
  });
  return { conversationId };
});

export const createGroup = onCall({ region }, async (request) => {
  const uid = uidOf(request);
  const name = cleanText(request.data?.name, 24, 'Nama grup');
  const about = typeof request.data?.about === 'string' ? request.data.about.trim().slice(0, 80) : '';
  const raw = Array.isArray(request.data?.memberUids) ? request.data.memberUids : [];
  const members = [...new Set([uid, ...raw.filter((v: unknown) => typeof v === 'string' && v.length < 129)])];
  if (members.length < 2) throw new HttpsError('invalid-argument', 'Pilih minimal satu kontak.');
  if (members.length > 50) throw new HttpsError('invalid-argument', 'Maksimal 50 anggota.');
  for (const member of members) {
    if (member === uid) continue;
    const contact = await db.doc(`users/${uid}/contacts/${member}`).get();
    if (!contact.exists) throw new HttpsError('permission-denied', 'Grup hanya bisa menambahkan kontak yang sudah disimpan.');
    const profile = await db.doc(`users/${member}`).get();
    if (!profile.exists || await blocked(uid, member)) throw new HttpsError('failed-precondition', 'Salah satu kontak tidak tersedia.');
  }
  const ref = db.collection('conversations').doc();
  await ref.set({
    type: 'group', groupName: name, groupAbout: about, groupAvatarUrl: '',
    members, admins: [uid], createdBy: uid,
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), lastMessage: null
  });
  return { conversationId: ref.id };
});

export const manageGroup = onCall({ region }, async (request) => {
  const uid = uidOf(request);
  const conversationId = cleanText(request.data?.conversationId, 128, 'Grup');
  const action = cleanText(request.data?.action, 24, 'Aksi');
  const ref = db.doc(`conversations/${conversationId}`);
  const snap = await ref.get();
  if (!snap.exists || snap.get('type') !== 'group') throw new HttpsError('not-found', 'Grup tidak ditemukan.');
  const data = snap.data()!;
  if (!data.members.includes(uid) || !data.admins.includes(uid)) throw new HttpsError('permission-denied', 'Hanya admin yang bisa mengubah grup.');
  if (action === 'metadata') {
    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (typeof request.data?.groupName === 'string') update.groupName = cleanText(request.data.groupName, 24, 'Nama grup');
    if (typeof request.data?.groupAbout === 'string') update.groupAbout = request.data.groupAbout.trim().slice(0, 80);
    if (typeof request.data?.groupAvatarUrl === 'string') update.groupAvatarUrl = request.data.groupAvatarUrl.slice(0, 2000);
    await ref.update(update);
  } else if (action === 'addMember') {
    const target = cleanText(request.data?.targetUid, 128, 'Anggota');
    const contact = await db.doc(`users/${uid}/contacts/${target}`).get();
    if (!contact.exists) throw new HttpsError('permission-denied', 'Tambahkan orang itu ke kontak terlebih dahulu.');
    if (await blocked(uid, target)) throw new HttpsError('failed-precondition', 'Kontak yang diblokir tidak bisa ditambahkan.');
    if (!(data.members as string[]).includes(target)) {
      if ((data.members as string[]).length >= 50) throw new HttpsError('resource-exhausted', 'Maksimal 50 anggota.');
      await ref.update({ members: FieldValue.arrayUnion(target), updatedAt: FieldValue.serverTimestamp() });
    }
  } else if (action === 'removeMember') {
    const target = cleanText(request.data?.targetUid, 128, 'Anggota');
    if (target === data.createdBy) throw new HttpsError('failed-precondition', 'Pembuat grup tidak bisa dikeluarkan.');
    if ((data.admins as string[]).includes(target) && (data.admins as string[]).length <= 1) throw new HttpsError('failed-precondition', 'Grup harus memiliki minimal satu admin.');
    await ref.update({ members: FieldValue.arrayRemove(target), admins: FieldValue.arrayRemove(target), updatedAt: FieldValue.serverTimestamp() });
  } else if (action === 'toggleAdmin') {
    const target = cleanText(request.data?.targetUid, 128, 'Anggota');
    if (!(data.members as string[]).includes(target)) throw new HttpsError('not-found', 'Anggota tidak ditemukan.');
    if ((data.admins as string[]).includes(target)) {
      if ((data.admins as string[]).length <= 1) throw new HttpsError('failed-precondition', 'Grup harus memiliki minimal satu admin.');
      await ref.update({ admins: FieldValue.arrayRemove(target) });
    } else await ref.update({ admins: FieldValue.arrayUnion(target) });
  } else {
    throw new HttpsError('invalid-argument', 'Aksi grup tidak dikenal.');
  }
  return { ok: true };
});

export const setBlock = onCall({ region }, async (request) => {
  const uid = uidOf(request);
  const targetUid = cleanText(request.data?.targetUid, 128, 'Pengguna');
  const shouldBlock = request.data?.blocked === true;
  if (uid === targetUid) throw new HttpsError('invalid-argument', 'Tidak bisa memblokir akun sendiri.');
  const ref = db.doc(`users/${uid}/blocks/${targetUid}`);
  if (shouldBlock) await ref.set({ createdAt: FieldValue.serverTimestamp() });
  else await ref.delete();
  return { ok: true, blocked: shouldBlock };
});

export const editMessage = onCall({ region }, async (request) => {
  const uid = uidOf(request);
  const conversationId = cleanText(request.data?.conversationId, 128, 'Percakapan');
  const messageId = cleanText(request.data?.messageId, 128, 'Pesan');
  const text = cleanText(request.data?.text, 4000, 'Pesan');
  const ref = db.doc(`conversations/${conversationId}/messages/${messageId}`);
  const snap = await ref.get();
  const convo = await db.doc(`conversations/${conversationId}`).get();
  if (!convo.exists || !convo.get('members').includes(uid) || !snap.exists || snap.get('senderId') !== uid) throw new HttpsError('permission-denied', 'Hanya pengirim yang masih menjadi anggota bisa mengedit pesan ini.');
  if (convo.get('type') === 'direct' && await blocked(convo.get('members')[0], convo.get('members')[1])) throw new HttpsError('permission-denied', 'Chat sedang diblokir.');
  if (snap.get('deletedForEveryone')) throw new HttpsError('failed-precondition', 'Pesan sudah dihapus.');
  const createdAt = snap.get('createdAt') as Timestamp | undefined;
  if (createdAt && Date.now() - createdAt.toMillis() > 15 * 60 * 1000) throw new HttpsError('deadline-exceeded', 'Pesan hanya bisa diedit selama 15 menit.');
  await ref.update({ text, editedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

export const deleteMessageForEveryone = onCall({ region }, async (request) => {
  const uid = uidOf(request);
  const conversationId = cleanText(request.data?.conversationId, 128, 'Percakapan');
  const messageId = cleanText(request.data?.messageId, 128, 'Pesan');
  const ref = db.doc(`conversations/${conversationId}/messages/${messageId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Pesan tidak ditemukan.');
  const convo = await db.doc(`conversations/${conversationId}`).get();
  if (!convo.exists || !convo.get('members').includes(uid)) throw new HttpsError('permission-denied', 'Akses ditolak.');
  const isOwner = snap.get('senderId') === uid;
  if (!isOwner) throw new HttpsError('permission-denied', 'Hanya pengirim pesan yang bisa menghapus untuk semua.');
  const createdAt = snap.get('createdAt') as Timestamp | undefined;
  if (createdAt && Date.now() - createdAt.toMillis() > 48 * 60 * 60 * 1000) throw new HttpsError('deadline-exceeded', 'Batas hapus untuk semua telah lewat.');
  const storagePath = snap.get('storagePath');
  await ref.update({ text: '', mediaUrl: '', storagePath: '', deletedForEveryone: true, deletedBy: uid, deletedAt: FieldValue.serverTimestamp() });
  if (typeof storagePath === 'string' && storagePath) await getStorage().bucket().file(storagePath).delete({ ignoreNotFound: true }).catch(() => {});
  return { ok: true };
});

export const deleteMessageForSelf = onCall({ region }, async (request) => {
  const uid = uidOf(request);
  const conversationId = cleanText(request.data?.conversationId, 128, 'Percakapan');
  const messageId = cleanText(request.data?.messageId, 128, 'Pesan');
  const convo = await db.doc(`conversations/${conversationId}`).get();
  if (!convo.exists || !convo.get('members').includes(uid)) throw new HttpsError('permission-denied', 'Akses ditolak.');
  await db.doc(`users/${uid}/hiddenMessages/${messageId}`).set({ conversationId, hiddenAt: FieldValue.serverTimestamp() });
  return { ok: true };
});


export const reactToMessage = onCall({ region }, async (request) => {
  const uid = uidOf(request);
  const conversationId = cleanText(request.data?.conversationId, 128, 'Percakapan');
  const messageId = cleanText(request.data?.messageId, 128, 'Pesan');
  const emoji = cleanText(request.data?.emoji, 12, 'Reaction');
  if (!['❤️', '👍', '😂', '😮', '😢', '🙏'].includes(emoji)) throw new HttpsError('invalid-argument', 'Reaction tidak didukung.');
  const convo = await db.doc(`conversations/${conversationId}`).get();
  if (!convo.exists || !convo.get('members').includes(uid)) throw new HttpsError('permission-denied', 'Akses ditolak.');
  if (convo.get('type') === 'direct' && await blocked(convo.get('members')[0], convo.get('members')[1])) throw new HttpsError('permission-denied', 'Chat sedang diblokir.');
  const messageRef = db.doc(`conversations/${conversationId}/messages/${messageId}`);
  const message = await messageRef.get();
  if (!message.exists || message.get('deletedForEveryone')) throw new HttpsError('not-found', 'Pesan tidak tersedia.');
  await messageRef.update({ [`reactions.${uid}`]: emoji });
  return { ok: true };
});

export const notifyNewMessage = onDocumentCreated({ document: 'conversations/{conversationId}/messages/{messageId}', region }, async (event) => {
  const message = event.data?.data();
  if (!message || !message.senderId) return;
  const convoSnap = await db.doc(`conversations/${event.params.conversationId}`).get();
  if (!convoSnap.exists) return;
  const convo = convoSnap.data()!;
  const senderSnap = await db.doc(`users/${message.senderId}`).get();
  const senderName = senderSnap.exists ? (senderSnap.get('displayName') || senderSnap.get('username')) : 'Pesan baru';
  const recipients = (convo.members as string[]).filter((id) => id !== message.senderId);
  for (const recipient of recipients) {
    if (await blocked(message.senderId, recipient)) continue;
    const devices = await db.collection(`users/${recipient}/devices`).get();
    const tokens = devices.docs.map((d) => String(d.get('token'))).filter(Boolean);
    if (!tokens.length) continue;
    const body = message.type === 'text' ? String(message.text || '').slice(0, 120) :
      message.type === 'audio' ? 'Voice message' : message.type === 'image' ? 'Photo' :
      message.type === 'video' ? 'Video' : message.type === 'sticker' ? 'Sticker' : 'Attachment';
    const usernameSnap = await db.doc(`users/${recipient}`).get();
    const username = usernameSnap.exists ? String(usernameSnap.get('username') || '') : '';
    const savedContact = await db.doc(`users/${recipient}/contacts/${message.senderId}`).get();
    const localSenderName = savedContact.exists ? String(savedContact.get('shortName') || savedContact.get('fullName') || senderName) : String(senderName);
    const mentioned = username && String(message.text || '').toLowerCase().includes(`@${username.toLowerCase()}`);
    const title = convo.type === 'group' ? String(convo.groupName || 'Group') : localSenderName;
    const notificationBody = mentioned ? `Pemberitahuan kepada anda · ${body}` : body;
    const response = await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title, body: notificationBody },
      data: { conversationId: event.params.conversationId, messageId: event.params.messageId },
      android: { priority: 'high', notification: { channelId: 'veyra_messages', sound: 'default' } }
    });
    const invalid = response.responses.map((r, i) => !r.success ? i : -1).filter((i) => i >= 0);
    await Promise.all(invalid.map((i) => devices.docs[i]?.ref.delete()).filter(Boolean));
    if (response.successCount > 0) await db.doc(`conversations/${event.params.conversationId}/messages/${event.params.messageId}`).update({ deliveredTo: FieldValue.arrayUnion(recipient) });
  }
});

export const expireStatuses = onSchedule({ schedule: 'every 60 minutes', region }, async () => {
  const expired = await db.collection('statuses').where('expiresAt', '<=', Timestamp.now()).limit(200).get();
  for (const status of expired.docs) {
    const storagePath = status.get('storagePath');
    if (typeof storagePath === 'string' && storagePath) await getStorage().bucket().file(storagePath).delete({ ignoreNotFound: true }).catch(() => {});
    await status.ref.delete();
  }
});

export const setUserOnline = onCall({ region }, async (request) => {
  const uid = uidOf(request);
  const online = request.data?.online === true;
  await db.doc(`users/${uid}`).update({ online, lastSeen: FieldValue.serverTimestamp() });
  return { ok: true };
});

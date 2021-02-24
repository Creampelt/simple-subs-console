const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const userDataCollection = (domain, uid) => (
  admin.firestore()
    .collection("domains")
    .doc(domain)
    .collection("userData")
    .doc(uid)
);

const throwError = (error) => {
  console.error(error);
  throw new functions.https.HttpsError(error.code, error.message);
};

const isAdmin = async (uid) => {
  let domain = (await admin.firestore().collection("userDomains").doc(uid).get()).data().domain;
  let doc = await userDataCollection(domain, uid).get().catch(throwError);
  if (!doc.exists || !(doc.data().accountType === "OWNER" || doc.data().accountType === "ADMIN")) {
    throwError({ code: "permission-denied", message: "User is not an admin" });
  } else {
    return domain;
  }
}

const getDomains = async () => {
  let domainsSnapshot = await admin.firestore().collection("userDomains").get();
  let domainsObj = {};
  for (let doc of domainsSnapshot.docs) {
    domainsObj[doc.id] = doc.data().domain;
  }
  return domainsObj;
}

const checkAuth = async (auth, uids) => {
  if (!auth) {
    throwError({ code: "permission-denied", message: "User is not signed in" });
  }
  const domain = await isAdmin(auth.uid);
  if (uids && uids.length > 0) {
    const userDomains = await getDomains();
    for (let uid of uids) {
      if (userDomains[uid] !== domain) {
        throwError({ code: "permission-denied", message: "Cannot edit users outside of domain" });
      }
    }
  }
  return domain;
};

const batchWrite = async (refs, action, extraData = {}) => {
  const maxWrites = 400; // write batch only allows maximum 500 writes per batch
  let batch = admin.firestore().batch();
  let i = 0;
  let rounds = 0;
  try {
    for (const ref of refs) {
      action(batch, ref, extraData);
      i++
      if (i >= maxWrites) {
        i = 0;
        rounds++;
        console.log("Intermediate committing of batch operation");
        await batch.commit();
        batch = admin.firestore().batch();
      }
    }
    if (i > 0) {
      console.log("Firebase batch operation completed. Doing final committing of batch operation.");
      await batch.commit();
    } else {
      console.log("Firebase batch operation completed.");
    }
  } catch (e) {
    console.log("Number of operations: " + (i + rounds * maxWrites));
    throwError(e);
  }
}

const deleteUserData = async (uids, domain, errorIndexes) => {
  let uidsToDelete = uids.filter((value, i) => !errorIndexes.includes(i));
  let refsToDelete = uidsToDelete.map((uid) => userDataCollection(domain, uid));
  await batchWrite(refsToDelete, (batch, ref) => batch.delete(ref));
}

exports.checkIsAdmin = functions.https.onCall( async (data, context) => {
  let { uid } = await admin.auth().getUserByEmail(data.email).catch(throwError);
  let domain = (await admin.firestore().collection("userDomains").doc(uid).get()).data().domain;
  let doc = await userDataCollection(domain, uid).get().catch(throwError);
  return doc.exists && (doc.data().accountType === "OWNER" || doc.data().accountType === "ADMIN");
});

exports.deleteUsers = functions.https.onCall(async (data, context) => {
  let uids = data.uids;
  let domain = await checkAuth(context.auth, uids);
  let deleteUsersResult = await admin.auth().deleteUsers(uids).catch(throwError);
  console.log("Successfully deleted " + deleteUsersResult.successCount + " users");
  console.log("Failed to delete " +  deleteUsersResult.failureCount + " users");
  deleteUsersResult.errors.forEach((error) => {
    console.error(error);
  });
  let errorIndexes = deleteUsersResult.errors.map(({ index }) => index);
  await deleteUserData(uids, domain, errorIndexes);
  return deleteUsersResult;
});

exports.listAllUsers = functions.https.onCall(async (data, context) => {
  const domain = await checkAuth(context.auth, []);
  // Assume that there are no more than 1000 users
  let listUsersResult = await admin.auth().listUsers(1000).catch(throwError);
  let userDomains = await getDomains();
  let users = {};
  for (let user of listUsersResult.users) {
    let userDomain = userDomains[user.uid];
    if (userDomain === domain) {
      users[user.uid] = { email: user.email };
    }
  }
  return users;
});

exports.setEmail = functions.https.onCall(async (data, context) => {
  await checkAuth(context.auth, [data.uid]);
  let uid = data.uid;
  await admin.auth().updateUser(uid, { email: data.email }).catch(throwError);
});

exports.resetPasswords = functions.https.onCall(async (data, context) => {
  const domain = await checkAuth(context.auth, data.uids);
  try {
    let doc = await admin.firestore().collection("domains").doc(domain)
      .collection("appData").doc("defaultUser")
      .get();
    let password = doc.data().password;
    let uids = data.uids;
    await Promise.all(uids.map((uid) => admin.auth().updateUser(uid, { password })));
    console.log("Successfully reset " + uids.length + " passwords to '" + password + "'.");
    return password;
  } catch (e) {
    throwError(e);
  }
});

exports.deleteFailedUser = functions.https.onCall(async (data, context) => {
  const uid = data.uid;
  if (context.auth.uid !== uid) {
    throwError({ code: "permission-denied", message: "You must be logged into the account to delete it." });
  }
  try {
    let doc = await admin.firestore().collection("userDomains").doc(uid).get();
    if (doc.exists && doc.data().domain) {
      throwError({ code: "permission-denied", message: "You cannot delete a successfully created account." })
    }
    await admin.auth().deleteUser(uid);
  } catch (e) {
    throwError(e);
  }
})

// const migrateCollection = async (srcCollection, destCollection, data = (doc) => doc, deleteAfter = false, condition = null) => {
//   const documents = await srcCollection.get();
//   let writeBatch = admin.firestore().batch();
//   let i = 0;
//   try {
//     for (const doc of documents.docs) {
//       if (condition) {
//         if (condition(doc.data())) {
//           writeBatch.set(destCollection.doc(doc.id), data(doc.data()));
//           i++;
//           if (deleteAfter) {
//             writeBatch.delete(doc.ref);
//             i++;
//           }
//         }
//       } else {
//         writeBatch.set(destCollection.doc(doc.id), data(doc.data()));
//         i++;
//         if (deleteAfter) {
//           writeBatch.delete(doc.ref);
//           i++;
//         }
//       }
//       if (i > 400) {  // write batch only allows maximum 500 writes per batch
//         i = 0;
//         console.log("Intermediate committing of batch operation");
//         await writeBatch.commit();
//         writeBatch = admin.firestore().batch();
//       }
//     }
//     if (i > 0) {
//       console.log("Firebase batch operation completed. Doing final committing of batch operation.");
//       await writeBatch.commit();
//     } else {
//       console.log("Firebase batch operation completed.");
//     }
//   } catch (e) {
//     console.error(e);
//     console.log("Number of operations: " + i);
//   }
// }

// exports.migrateToDomains = functions.https.onCall(async (data, context) => {
//   const lwhsCollection = admin.firestore().collection("domains").doc("lwhs").collection("userData");
//   const userDataCollection = admin.firestore().collection("userData");
//   await migrateCollection(userDataCollection, lwhsCollection);
//   await migrateCollection(userDataCollection, admin.firestore().collection("userDomains"), () => ({ domain: "lwhs" }));
//
//   const snapshot = await userDataCollection.get();
//   for (const doc of snapshot.docs) {
//     await migrateCollection(userDataCollection.doc(doc.id).collection("myPresets"), lwhsCollection.doc(doc.id).collection("myPresets"));
//   }
// });
//
// exports.manualMigrate = functions.https.onCall(async (data, context) => {
//   const srcCollection = admin.firestore().collection("allOrders").where("date", ">", "2021-01-20");
//   const targetCollection = admin.firestore().collection("domains").doc("lwhs").collection("orders");
//   await migrateCollection(srcCollection, targetCollection);
// });

exports.migrateToDomain = functions.firestore
  .document("allOrders/{order}")
  .onWrite(async (change, context) => {
    const targetCollection = admin.firestore().collection("domains").doc("lwhs").collection("orders");
    const data = change.after.exists ? change.after.data() : null;
    if (!data) {
      await targetCollection.doc(context.params.order).delete();
      console.log("Deleted order " + context.params.order);
    } else {
      await targetCollection.doc(context.params.order).set(data);
      console.log("Updated order " + context.params.order);
    }
  });

exports.updateDomainData = functions.https.onCall(async (data, context) => {
  const domain = await checkAuth(context.auth);
  if (domain !== data.id) {
    throwError({ code: "permission-denied", message: "You may only edit data for your own organization." });
  }
  try {
    await admin.firestore().collection("domains").doc(data.id).set(data.data);
  } catch (e) {
    throwError(e);
  }
});

//
// exports.migrateToExample = functions.https.onCall(async (data, context) => {
//   const lwhsCollection = admin.firestore().collection("domains)").doc("example").collection("userData");
//   const exampleCollection = admin.firestore().collection("domains").doc("example").collection("userData");
//   await migrateCollection(lwhsCollection, exampleCollection, null, true, ({ name }) => (name === "MIT Admissions" || name === "Harvard Admissions" || name === "Jane Doe"));
// })
//
// exports.mapAcross = functions.https.onCall(async (data, context) => {
//   const col = admin.firestore().collection("domains").doc("lwhs").collection("pastOrders");
//   const deleteUid = (data) => {
//     let newData = { ...data };
//     delete newData.key;
//     return newData;
//   }
//   await migrateCollection(col, col, deleteUid);
// });
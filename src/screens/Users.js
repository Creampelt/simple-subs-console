import React from "react";
import Table from "../components/Table";
import HamburgerButton from "../components/HamburgerButton";
import { connect } from "react-redux";
import { deleteUsers, resetPasswords, updateUser } from "../redux/Actions";
import Loading from "./Loading";
import { UserColumns } from "../constants/TableConstants";

const Users = ({ navbarHeight, users, userFields, user, deleteUsers, resetPasswords, updateUser, domain }) => {
  const userData = React.useMemo(
    () => (users && userFields) ? Object.keys(users).map((uid) => ({ ...users[uid], uid })) : null,
    [userFields, users]
  );
  const columns = React.useMemo(
    () => userFields ? userFields.map((field) => ({...field, type: field.inputType})) : null,
    [userFields]
  );

  if (!userData) {
    return <Loading />
  }
  const deleteSelected = (selected) => {
    deleteUsers(Object.keys(selected).map((index) => userData[index].uid), user.uid);
  };
  const resetSelected = (selected) => {
    resetPasswords(Object.keys(selected).map((index) => userData[index].uid));
  }
  const MenuButtons = {
    Right: ({ selected, setCarefulSubmit }) => (
      <HamburgerButton
        selected={selected}
        actions={(anySelected = false) => {
          let actions = [
            {
              title: `Reset ${anySelected ? "selected" : "all"} passwords`,
              action: () => setCarefulSubmit(() => () => resetSelected(selected))
            }
          ];
          if (anySelected) {
            actions.push({
              title: "Delete selected users",
              action: () => setCarefulSubmit(() => () => deleteSelected(selected))
            });
          }
          return actions;
        }}
      />
    )
  };

  const editUser = (index, editedUser) => {
    let newData = { ...editedUser };
    delete newData.key;
    delete newData.uid;
    updateUser(editedUser.uid, editedUser, users[editedUser.uid], domain);
  }

  return (
    <div id={"Users"} className={"content-container"} style={{ height: "calc(100vh - " + navbarHeight + "px)" }}>
      <Table
        data={userData}
        columns={columns}
        title={"Users"}
        MenuButtons={MenuButtons}
        extraParams={{ user }}
        onEdit={editUser}
        extraFields={[{ key: "uid" }]}
        defaultSortCol={"grade"}
      />
    </div>
  )
};

const mapStateToProps = ({ users, appSettings, user, domain }) => ({
  users,
  userFields: appSettings?.userFields ? [UserColumns[0], ...appSettings.userFields, UserColumns[1]] : null,
  user,
  domain: domain.id
});

const mapDispatchToProps = (dispatch) => ({
  deleteUsers: (selected, uid) => deleteUsers(selected, uid, dispatch),
  resetPasswords: (uids) => resetPasswords(uids, dispatch),
  updateUser: (uid, userData, prevData, domain) => updateUser(uid, userData, prevData, dispatch, domain)
})

export default connect(mapStateToProps, mapDispatchToProps)(Users);
class User {
  constructor({ id, email, fullName, role = "CUSTOMER" }) {
    if (!email || !email.includes("@")) {
      throw new Error("Необхідно вказати коректний email");
    }
    this.id = id;
    this.email = email.toLowerCase().trim();
    this.fullName = fullName;
    this.role = role;
  }

  isAdmin() {
    return this.role === "ADMIN";
  }
}

module.exports = { User };
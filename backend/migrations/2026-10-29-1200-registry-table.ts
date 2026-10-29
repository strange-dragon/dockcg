import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
    // Registry credentials. One registry list per Dockge instance,
    // because docker credentials live in the docker daemon's config anyway.
    return knex.schema.createTable("registry", (table) => {
        table.increments("id");
        table.string("name", 255).notNullable();
        table.string("url", 255).notNullable();
        table.string("username", 255).notNullable();
        table.string("password", 1024).notNullable();
        // redbean maps the `createdDate` bean property onto this snake_case column
        table.string("created_date", 255);
    });
}

export async function down(knex: Knex): Promise<void> {
    return knex.schema.dropTable("registry");
}

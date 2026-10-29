import { BeanModel } from "redbean-node/dist/bean-model";
import { R } from "redbean-node";
import { LooseObject } from "../../common/util-common";

export class Registry extends BeanModel {

    /**
     * All registries of this Dockge instance, oldest first.
     */
    static async getRegistryList() : Promise<Registry[]> {
        return await R.findAll("registry", " 1 = 1 ORDER BY id ASC ", []) as Registry[];
    }

    /**
     * Never expose the (encrypted) password to the client.
     */
    toJSON() : LooseObject {
        return {
            id: this.id,
            name: this.name,
            url: this.url,
            username: this.username,
            createdDate: this.createdDate,
            hasPassword: !!this.password,
        };
    }
}

export default Registry;
